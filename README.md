# wso2-synapse-validator

> XML/XSD validation engine for the WSO2 MI Language Server — Apache Xerces-C compiled to WebAssembly.

Schema is compiled once per project into a persistent WASM grammar pool. Every `validate()` call reuses it — no re-parsing on keystrokes.

---

## How it works

```
[ JavaScript Side ]                        [ WASM / C++ Linear Memory ]

                          .init()
┌─────────────────────┐ ─────────────────> ┌────────────────────────────┐
│  80+ XSD Files      │                    │  MemoryEntityResolver      │
│  (strings / Buffer) │                    │  (Virtual File System)     │
└─────────────────────┘                    └─────────────┬──────────────┘
                                                         │  resolves xs:include
                                                         ▼
                                           ┌────────────────────────────┐
                                           │  SAXParser  (Compiler)     │
                                           └─────────────┬──────────────┘
                                                         │  cacheGrammarFromParse
                                                         ▼
                                           ┌────────────────────────────┐
                                           │  XMLGrammarPoolImpl        │
                                           │  (Locked, compiled tree)   │
                                           └────────────────────────────┘

                          .validate()
┌─────────────────────┐ ─────────────────> ┌────────────────────────────┐
│  XML document       │                    │  SAXParser                 │
│  (string / Buffer)  │                    │  useCachedGrammarInParse   │
└─────────────────────┘                    │  ──> pool lookup (no parse)│
                                           └─────────────┬──────────────┘
                                                         │
                                                         ▼
                                           ┌────────────────────────────┐
                         <─────────────────│  ValidationResult          │
                                           └────────────────────────────┘
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
