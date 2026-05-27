# wso2-synapse-validator

> XML/XSD validation engine for the WSO2 MI Language Server — Apache Xerces-C compiled to WebAssembly.

Schema is compiled once per project into a persistent WASM grammar pool. Every `validate()` call reuses it — no re-parsing on keystrokes.

---

## How it works

### Phase 1 — `init()` — runs once when the project opens

```
  JavaScript                         WASM Linear Memory
  ──────────────────────────────     ──────────────────────────────────────────────

  createProjectValidator({
    entry: "mediators.xsd",
    files: {                   ──>   ┌─────────────────────────────────────────┐
      "mediators.xsd":  "...",       │  MemoryEntityResolver                   │
      "connectors.xsd": "...",       │  (in-memory virtual file system)        │
      "api.xsd":        "...",       │                                         │
      ...80 files                    │  "mediators.xsd"  → <xsd content>       │
    }                                │  "connectors.xsd" → <xsd content>       │
  })                                 │  "api.xsd"        → <xsd content>  ...  │
                                     └──────────────────┬──────────────────────┘
                                                        │
                                          SAXParser calls resolveEntity()
                                          for every xs:include it encounters
                                                        │
                                                        ▼
                                     ┌─────────────────────────────────────────┐
                                     │  SAXParser  [ cacheGrammarFromParse ]   │
                                     │                                         │
                                     │  reads mediators.xsd                    │
                                     │    └─ xs:include "connectors.xsd" ──>   │
                                     │    └─ xs:include "api.xsd"        ──>   │
                                     │    └─ ... (resolves all 80 files)       │
                                     └──────────────────┬──────────────────────┘
                                                        │ compiles entire schema tree
                                                        ▼
                                     ┌─────────────────────────────────────────┐
                                     │  XMLGrammarPoolImpl  [ LOCKED ]         │
                                     │                                         │
                                     │  fully compiled grammar lives here      │
                                     │  persists in WASM memory                │
                                     │  shared across all validate() calls     │
                                     └─────────────────────────────────────────┘
```

### Phase 2 — `validate()` — runs on every keystroke

```
  JavaScript                         WASM Linear Memory
  ──────────────────────────────     ──────────────────────────────────────────────

  proj.validate(xmlContent)  ──>    ┌─────────────────────────────────────────┐
                                    │  SAXParser  [ useCachedGrammarInParse ] │
  (only the XML crosses             │                                         │
   the JS → WASM boundary)         │  looks up compiled grammar from pool    │
                                    │  NO schema parsing — pool already ready │
                                    └──────────────────┬──────────────────────┘
                                                       │
                                                       ▼
                                    ┌─────────────────────────────────────────┐
                                    │  XMLGrammarPoolImpl  [ LOCKED ]         │
                                    │  (reused, untouched)                    │
                                    └──────────────────┬──────────────────────┘
                                                       │
  {                          <──                       │ validates XML
    valid: true/false,                                 ▼
    parseErrors:  [...],          ┌─────────────────────────────────────────┐
    schemaErrors: [...]           │  ValidationResult                       │
  }                               └─────────────────────────────────────────┘
```

---

## Multiple projects

Each project gets its own grammar pool in WASM memory. They share one WASM instance but never share state.

```
WASM instance (one, shared)
│
├── ProjectValidator [workspace A]  — MI 4.3.0, no connectors
│     pool: [4.3.0 grammar]
│
├── ProjectValidator [workspace B]  — MI 4.3.0, s3 connector
│     pool: [4.3.0 + s3 grammar]
│
├── ProjectValidator [workspace C]  — MI 4.4.0, no connectors
│     pool: [4.4.0 grammar]
│
└── ProjectValidator [workspace D]  — MI 4.4.0, s3 + http connectors
      pool: [4.4.0 + s3 + http grammar]
```

---

## Build

Requires [Emscripten](https://emscripten.org/).

```bash
npm run build:wasm   # compile Xerces-C → wasm/xerces_validator.{js,wasm}
npm run build:ts     # compile TypeScript → dist/
npm test
```

---

## License

MIT — see [LICENSE](./LICENSE).  
Includes Apache Xerces-C — see [native/xerces-c/LICENSE](native/xerces-c/LICENSE).
