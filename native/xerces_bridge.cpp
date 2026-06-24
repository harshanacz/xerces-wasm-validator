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
    std::string systemId;
};

class CollectingErrorHandler : public ErrorHandler {
public:
    std::vector<DiagnosticEntry> entries;
    bool hasFatal = false;

    void warning(const SAXParseException& e) override {
        entries.push_back({ transcode(e.getMessage()),
            (int)e.getLineNumber(), (int)e.getColumnNumber(), "warning",
            transcode(e.getSystemId()) });
    }
    void error(const SAXParseException& e) override {
        entries.push_back({ transcode(e.getMessage()),
            (int)e.getLineNumber(), (int)e.getColumnNumber(), "error",
            transcode(e.getSystemId()) });
    }
    void fatalError(const SAXParseException& e) override {
        entries.push_back({ transcode(e.getMessage()),
            (int)e.getLineNumber(), (int)e.getColumnNumber(), "fatal",
            transcode(e.getSystemId()) });
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

static bool endsWith(const std::string& value, const std::string& suffix) {
    return value.size() >= suffix.size() &&
        value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

static bool isIgnorableXmlSchemaDtdWarning(const DiagnosticEntry& e) {
    return e.severity == "warning" &&
        e.message == "attribute 'xmlns' has already been declared for element 'schema'" &&
        endsWith(e.systemId, "XMLSchema.dtd");
}

// ── Entity resolver that serves any number of XSDs from memory ───────────────
// Schemas are registered by their full URI (e.g. "memory:///main.xsd").
// Xerces cannot resolve relative URIs against unknown schemes, so when the
// entry schema has xs:include schemaLocation='types.xsd', Xerces calls
// resolveEntity with the bare filename "types.xsd" rather than the resolved
// "memory:///types.xsd".  The basename fallback handles both cases.
class MemoryEntityResolver : public EntityResolver {
    std::map<std::string, std::string> _byUri;      // full URI → content
    std::map<std::string, std::string> _byName;     // bare filename → content
    std::map<std::string, std::string> _nameToUri;  // bare filename → canonical URI

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
        const std::string bname = basename(uri);
        _byName[bname] = content;
        // Only record first registration so the canonical URI is stable.
        if (_nameToUri.find(bname) == _nameToUri.end())
            _nameToUri[bname] = uri;
    }

    void clear() {
        _byUri.clear();
        _byName.clear();
        _nameToUri.clear();
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

        // Xerces may pass a bare filename or relative path when the URI scheme
        // is unknown.  Always serve with the canonical memory:/// URI so Xerces'
        // schema cache de-duplicates includes properly.
        const std::string bname = basename(sid);
        auto it2 = _byName.find(bname);
        if (it2 != _byName.end()) {
            const std::string& canonUri = _nameToUri.at(bname);
            return serve(it2->second, canonUri);
        }

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

// Extract the targetNamespace value from XSD text (returns "" for no-namespace
// schemas).  Accepts both single- and double-quoted attribute values and
// tolerates whitespace around '=', e.g. targetNamespace = 'urn:x'.
static std::string extractTargetNamespace(const std::string& xsdText) {
    auto isXmlSpace = [](char c) {
        return c == ' ' || c == '\t' || c == '\n' || c == '\r';
    };

    const std::string attr = "targetNamespace";
    for (size_t pos = xsdText.find(attr); pos != std::string::npos;
         pos = xsdText.find(attr, pos + attr.size())) {
        // Require a standalone attribute name: the char before must be
        // whitespace (or the match starts the text) so we don't match a
        // substring like "fooTargetNamespace".
        if (pos != 0 && !isXmlSpace(xsdText[pos - 1])) continue;

        size_t cur = pos + attr.size();
        while (cur < xsdText.size() && isXmlSpace(xsdText[cur])) cur++;
        if (cur >= xsdText.size() || xsdText[cur] != '=') continue;
        cur++;  // past '='
        while (cur < xsdText.size() && isXmlSpace(xsdText[cur])) cur++;
        if (cur >= xsdText.size()) continue;

        const char quote = xsdText[cur];
        if (quote != '"' && quote != '\'') continue;
        cur++;  // past opening quote

        const size_t end = xsdText.find(quote, cur);
        if (end == std::string::npos) return "";
        return xsdText.substr(cur, end - cur);
    }
    return "";
}

// Pass 2 — schema validation
// schemaMap:       full URI → XSD content (may contain many entries for xs:import/xs:include)
// entryUri:        the URI set on the parser as the starting schema
// targetNamespace: the targetNamespace of the entry schema ("" for no-namespace schemas)
static std::vector<DiagnosticEntry> runSchemaPass(
    const std::string& xmlText,
    const std::map<std::string, std::string>& schemaMap,
    const std::string& entryUri,
    const std::string& targetNamespace)
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
    parser.setValidationSchemaFullChecking(false);  // disable UPA/restriction checks

    if (targetNamespace.empty()) {
        parser.setExternalNoNamespaceSchemaLocation(entryUri.c_str());
    } else {
        std::string schemaLoc = targetNamespace + " " + entryUri;
        parser.setExternalSchemaLocation(schemaLoc.c_str());
    }

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
// targetNsParam (optional): explicit namespace URI; overrides auto-detection from the XSD.
//   Pass null/undefined to keep the existing auto-detect behaviour.
emscripten::val validate(const std::string& xmlText, emscripten::val xsdParam, emscripten::val targetNsParam) {
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
        std::string targetNs;
        if (!targetNsParam.isUndefined() && !targetNsParam.isNull()) {
            targetNs = targetNsParam.as<std::string>();
        } else {
            targetNs = extractTargetNamespace(schemaMap.at(entryUri));
        }
        auto pass2 = runSchemaPass(xmlText, schemaMap, entryUri, targetNs);
        for (auto& e : pass2)
            if (!isIgnorableXmlSchemaDtdWarning(e))
                schemaErrors.push_back(e);  // include fatal: schema-load failures must surface
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

// ═══════════════════════════════════════════════════════════════════════════════
// ProjectValidator — persistent validator with a cached grammar pool.
//
// Solves the "re-parse 80 XSD files on every keystroke" problem.  The base
// schemas are parsed once into an XMLGrammarPool that lives in WASM memory.
// Each subsequent validate() call reuses the compiled grammar — no parsing.
//
// When connectors.xsd changes (user downloads a connector), call
// updateConnectors() to swap that one file and rebuild the pool.  Validation
// stays fast.
// ═══════════════════════════════════════════════════════════════════════════════

class ProjectValidator {
    XMLGrammarPoolImpl*  _pool;
    MemoryEntityResolver _resolver;
    std::string          _entryName;       // bare filename, e.g. "mediators.xsd"
    std::string          _entryUri;        // "memory:///mediators.xsd"
    std::string          _entryContent;
    std::string          _targetNamespace;
    bool                 _ready = false;

    bool compilePool() {
        // unlockPool() is a no-op if already unlocked.
        _pool->unlockPool();
        _pool->clear();

        SAXParser parser(nullptr, XMLPlatformUtils::fgMemoryManager, _pool);
        CollectingErrorHandler handler;
        parser.setErrorHandler(&handler);
        parser.setEntityResolver(&_resolver);
        parser.setDoNamespaces(true);
        parser.setDoSchema(true);
        parser.setValidationSchemaFullChecking(false);
        parser.cacheGrammarFromParse(true);

        try {
            MemBufInputSource src(
                (const XMLByte*)_entryContent.c_str(),
                _entryContent.size(),
                _entryUri.c_str());
            parser.loadGrammar(src, Grammar::SchemaGrammarType, true);
        } catch (...) {
            return false;
        }

        _pool->lockPool();

        // Strings no longer needed — grammar is compiled into the pool.
        // The resolver is empty during validate(); the locked pool serves everything.
        _resolver.clear();
        _entryContent.clear();

        return true;
    }

public:
    ProjectValidator() {
        ensureInit();
        _pool = new XMLGrammarPoolImpl(XMLPlatformUtils::fgMemoryManager);
    }

    ~ProjectValidator() {
        delete _pool;
    }

    // Load all base XSD files into the pool.
    // entryName: bare filename of the root schema (e.g. "mediators.xsd")
    // filesObj:  JS object mapping filename → XSD content
    // targetNsParam: optional explicit namespace; auto-detected if null/undefined
    bool init(
        const std::string& entryName,
        emscripten::val filesObj,
        emscripten::val targetNsParam)
    {
        _resolver.clear();
        _entryName = entryName;
        _entryContent.clear();
        _ready = false;

        emscripten::val keys =
            emscripten::val::global("Object").call<emscripten::val>("keys", filesObj);
        int len = keys["length"].as<int>();

        for (int i = 0; i < len; i++) {
            std::string name    = keys[i].as<std::string>();
            std::string content = filesObj[name].as<std::string>();
            std::string uri     = "memory:///" + name;
            _resolver.add(uri, content);

            if (name == entryName) {
                _entryContent = content;
                _entryUri     = uri;
            }
        }

        if (_entryContent.empty()) return false;

        if (!targetNsParam.isUndefined() && !targetNsParam.isNull()) {
            _targetNamespace = targetNsParam.as<std::string>();
        } else {
            _targetNamespace = extractTargetNamespace(_entryContent);
        }

        _ready = compilePool();
        return _ready;
    }

    bool isReady() const { return _ready; }

    emscripten::val validate(const std::string& xmlText) {
        auto result    = emscripten::val::object();
        auto parseArr  = emscripten::val::array();
        auto schemaArr = emscripten::val::array();

        // Pass 1 — syntax only (same as legacy path)
        auto pass1 = runSyntaxPass(xmlText);
        std::vector<DiagnosticEntry> parseErrors;
        for (auto& e : pass1)
            if (e.severity == "fatal")
                parseErrors.push_back(e);

        // Pass 2 — schema validation using the cached pool.  No re-parsing.
        std::vector<DiagnosticEntry> schemaErrors;
        if (_ready) {
            SAXParser parser(nullptr, XMLPlatformUtils::fgMemoryManager, _pool);
            CollectingErrorHandler handler;
            parser.setErrorHandler(&handler);
            parser.setEntityResolver(&_resolver);
            parser.setDoNamespaces(true);
            parser.setValidationScheme(SAXParser::Val_Always);
            parser.setDoSchema(true);
            parser.setValidationSchemaFullChecking(false);
            parser.useCachedGrammarInParse(true);
            parser.cacheGrammarFromParse(false);

            if (_targetNamespace.empty()) {
                parser.setExternalNoNamespaceSchemaLocation(_entryUri.c_str());
            } else {
                std::string schemaLoc = _targetNamespace + " " + _entryUri;
                parser.setExternalSchemaLocation(schemaLoc.c_str());
            }

            try {
                MemBufInputSource xmlSrc(
                    (const XMLByte*)xmlText.c_str(), xmlText.size(), "document");
                parser.parse(xmlSrc);
            } catch (const SAXParseException&) {
            } catch (...) {}

            for (auto& e : handler.entries)
                if (!isIgnorableXmlSchemaDtdWarning(e))
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
};

EMSCRIPTEN_BINDINGS(xerces_bridge) {
    emscripten::function("validate", &validate);

    emscripten::class_<ProjectValidator>("ProjectValidator")
        .constructor<>()
        .function("init",     &ProjectValidator::init)
        .function("isReady",  &ProjectValidator::isReady)
        .function("validate", &ProjectValidator::validate);
}
