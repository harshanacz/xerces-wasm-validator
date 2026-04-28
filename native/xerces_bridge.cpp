#include <string>
#include <vector>
#include <map>
#include <xercesc/util/PlatformUtils.hpp>
#include <xercesc/parsers/SAXParser.hpp>
#include <xercesc/framework/MemBufInputSource.hpp>
#include <xercesc/sax/HandlerBase.hpp>
#include <xercesc/validators/common/Grammar.hpp>
#include <xercesc/framework/XMLGrammarPoolImpl.hpp>
#include <xercesc/sax/EntityResolver.hpp>
#include <xercesc/sax/InputSource.hpp>
#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace xercesc;

static bool gXercesInitialized = false;

static void ensureInit() {
    if (!gXercesInitialized) {
        XMLPlatformUtils::Initialize();
        gXercesInitialized = true;
    }
}

struct DiagnosticEntry {
    std::string message;
    int         line;
    int         column;
    std::string severity;
};

class CollectingErrorHandler : public ErrorHandler {
public:
    std::vector<DiagnosticEntry> entries;
    bool hasFatal = false;

    void warning(const SAXParseException& e) override {
        entries.push_back({ transcode(e.getMessage()),
            (int)e.getLineNumber(), (int)e.getColumnNumber(), "warning" });
    }
    void error(const SAXParseException& e) override {
        entries.push_back({ transcode(e.getMessage()),
            (int)e.getLineNumber(), (int)e.getColumnNumber(), "error" });
    }
    void fatalError(const SAXParseException& e) override {
        entries.push_back({ transcode(e.getMessage()),
            (int)e.getLineNumber(), (int)e.getColumnNumber(), "fatal" });
        hasFatal = true;
        throw e;
    }
    void resetErrors() override {
        entries.clear();
        hasFatal = false;
    }

private:
    static std::string transcode(const XMLCh* s) {
        char* c = XMLString::transcode(s);
        std::string result(c);
        XMLString::release(&c);
        return result;
    }
};

// ── Entity resolver that serves any number of XSDs from memory ───────────────
// Schemas are registered by their full URI (e.g. "memory:///main.xsd").
// Xerces cannot resolve relative URIs against unknown schemes, so when the
// entry schema has xs:include schemaLocation='types.xsd', Xerces calls
// resolveEntity with the bare filename "types.xsd" rather than the resolved
// "memory:///types.xsd".  The basename fallback handles both cases.
class MemoryEntityResolver : public EntityResolver {
    std::map<std::string, std::string> _byUri;   // full URI → content
    std::map<std::string, std::string> _byName;  // bare filename → content

    static std::string basename(const std::string& uri) {
        size_t slash = uri.rfind('/');
        return slash == std::string::npos ? uri : uri.substr(slash + 1);
    }

    InputSource* serve(const std::string& content, const std::string& sid) {
        return new MemBufInputSource(
            (const XMLByte*)content.c_str(), content.size(), sid.c_str());
    }

public:
    void add(const std::string& uri, const std::string& content) {
        _byUri[uri] = content;
        _byName[basename(uri)] = content;
    }

    InputSource* resolveEntity(
        const XMLCh* const /* publicId */,
        const XMLCh* const systemId) override
    {
        char* raw = XMLString::transcode(systemId);
        std::string sid(raw);
        XMLString::release(&raw);

        auto it = _byUri.find(sid);
        if (it != _byUri.end()) return serve(it->second, sid);

        // Xerces falls back to bare filename when the URI scheme is unknown
        auto it2 = _byName.find(basename(sid));
        if (it2 != _byName.end()) return serve(it2->second, sid);

        return nullptr;
    }
};

// Pass 1 — syntax only, no schema
static std::vector<DiagnosticEntry> runSyntaxPass(const std::string& xmlText) {
    SAXParser parser;
    CollectingErrorHandler handler;
    parser.setErrorHandler(&handler);
    parser.setDoNamespaces(true);
    parser.setValidationScheme(SAXParser::Val_Never);

    try {
        MemBufInputSource xmlSrc(
            (const XMLByte*)xmlText.c_str(), xmlText.size(), "document");
        parser.parse(xmlSrc);
    } catch (const SAXParseException&) {
    } catch (...) {}

    return handler.entries;
}

// Pass 2 — schema validation
// schemaMap: full URI → XSD content (may contain many entries for xs:import/xs:include)
// entryUri:  the URI set on the parser as the starting schema
static std::vector<DiagnosticEntry> runSchemaPass(
    const std::string& xmlText,
    const std::map<std::string, std::string>& schemaMap,
    const std::string& entryUri)
{
    SAXParser parser;
    CollectingErrorHandler handler;
    MemoryEntityResolver resolver;
    for (const auto& kv : schemaMap)
        resolver.add(kv.first, kv.second);

    parser.setErrorHandler(&handler);
    parser.setEntityResolver(&resolver);
    parser.setDoNamespaces(true);
    parser.setValidationScheme(SAXParser::Val_Always);
    parser.setDoSchema(true);
    parser.setValidationSchemaFullChecking(true);
    parser.setExternalNoNamespaceSchemaLocation(entryUri.c_str());

    try {
        MemBufInputSource xmlSrc(
            (const XMLByte*)xmlText.c_str(), xmlText.size(), "document");
        parser.parse(xmlSrc);
    } catch (const SAXParseException&) {
    } catch (...) {}

    return handler.entries;
}

// xsdParam is either:
//   • a string  → single schema (original behaviour)
//   • an object → { entry: string, imports?: { [filename]: string } }
emscripten::val validate(const std::string& xmlText, emscripten::val xsdParam) {
    ensureInit();

    const std::string entryUri = "memory:///main.xsd";
    std::map<std::string, std::string> schemaMap;
    bool hasSchema = false;

    // Distinguish string vs bundle object by checking for the "entry" property.
    // A JS string primitive has no "entry" property, so it comes back undefined.
    emscripten::val entryProp = xsdParam["entry"];
    if (entryProp.isUndefined() || entryProp.isNull()) {
        // Single-schema string path
        std::string xsdText = xsdParam.as<std::string>();
        if (!xsdText.empty()) {
            schemaMap[entryUri] = xsdText;
            hasSchema = true;
        }
    } else {
        // Multi-schema bundle: { entry: string, imports?: Record<string,string> }
        schemaMap[entryUri] = entryProp.as<std::string>();
        hasSchema = true;

        emscripten::val imports = xsdParam["imports"];
        if (!imports.isUndefined() && !imports.isNull()) {
            emscripten::val keys =
                emscripten::val::global("Object").call<emscripten::val>("keys", imports);
            int len = keys["length"].as<int>();
            for (int i = 0; i < len; i++) {
                std::string key     = keys[i].as<std::string>();
                std::string content = imports[key].as<std::string>();
                schemaMap["memory:///" + key] = content;
            }
        }
    }

    auto result    = emscripten::val::object();
    auto parseArr  = emscripten::val::array();
    auto schemaArr = emscripten::val::array();

    // Pass 1 — syntax only
    auto pass1 = runSyntaxPass(xmlText);
    std::vector<DiagnosticEntry> parseErrors;
    for (auto& e : pass1)
        if (e.severity == "fatal")
            parseErrors.push_back(e);

    // Pass 2 — schema validation
    std::vector<DiagnosticEntry> schemaErrors;
    if (hasSchema) {
        auto pass2 = runSchemaPass(xmlText, schemaMap, entryUri);
        for (auto& e : pass2)
            if (e.severity == "error" || e.severity == "warning")
                schemaErrors.push_back(e);
    }

    for (auto& e : parseErrors) {
        auto obj = emscripten::val::object();
        obj.set("message",  e.message);
        obj.set("line",     e.line);
        obj.set("column",   e.column);
        obj.set("severity", e.severity);
        parseArr.call<void>("push", obj);
    }

    for (auto& e : schemaErrors) {
        auto obj = emscripten::val::object();
        obj.set("message",  e.message);
        obj.set("line",     e.line);
        obj.set("column",   e.column);
        obj.set("severity", e.severity);
        schemaArr.call<void>("push", obj);
    }

    bool valid = parseErrors.empty() && schemaErrors.empty();
    result.set("valid",        valid);
    result.set("parseErrors",  parseArr);
    result.set("schemaErrors", schemaArr);
    return result;
}

EMSCRIPTEN_BINDINGS(xerces_bridge) {
    emscripten::function("validate", &validate);
}
