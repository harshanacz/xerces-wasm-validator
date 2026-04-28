#include <string>
#include <vector>
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

// ── Entity resolver that serves XSD from memory ───────────────────────────────
// When Xerces tries to open the schema URI, we intercept and return
// the XSD text directly from memory instead of trying to open a file.
class MemoryEntityResolver : public EntityResolver {
public:
    const std::string& xsdText;
    const char*        schemaId;

    MemoryEntityResolver(const std::string& xsd, const char* id)
        : xsdText(xsd), schemaId(id) {}

    InputSource* resolveEntity(
        const XMLCh* const /* publicId */,
        const XMLCh* const systemId) override
    {
        // Check if this is our schema being requested
        char* sysIdStr = XMLString::transcode(systemId);
        std::string sid(sysIdStr);
        XMLString::release(&sysIdStr);

        if (sid == schemaId) {
            // Serve XSD from memory
            return new MemBufInputSource(
                (const XMLByte*)xsdText.c_str(),
                xsdText.size(),
                schemaId);
        }
        // Let Xerces handle anything else normally
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

// Pass 2 — schema validation with memory entity resolver
static std::vector<DiagnosticEntry> runSchemaPass(
    const std::string& xmlText,
    const std::string& xsdText)
{
    const char* schemaId = "urn:xerces-wasm:schema";

    SAXParser parser;
    CollectingErrorHandler handler;
    MemoryEntityResolver resolver(xsdText, schemaId);

    parser.setErrorHandler(&handler);
    parser.setEntityResolver(&resolver);
    parser.setDoNamespaces(true);
    parser.setValidationScheme(SAXParser::Val_Always);
    parser.setDoSchema(true);
    parser.setValidationSchemaFullChecking(true);

    // Point parser at our in-memory schema URI
    // Entity resolver will intercept and serve it from memory
    parser.setExternalNoNamespaceSchemaLocation(schemaId);

    try {
        MemBufInputSource xmlSrc(
            (const XMLByte*)xmlText.c_str(), xmlText.size(), "document");
        parser.parse(xmlSrc);
    } catch (const SAXParseException&) {
    } catch (...) {}

    return handler.entries;
}

emscripten::val validate(const std::string& xmlText, const std::string& xsdText) {
    ensureInit();

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
    if (!xsdText.empty()) {
        auto pass2 = runSchemaPass(xmlText, xsdText);
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
