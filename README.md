# High-Performance WASM XML Validator

> Blazing fast XML validator powered by Apache Xerces-C++ compiled to WebAssembly. 
> Features in-memory XSD caching for zero-overhead, instant validation.

## How it works (The Theory)

Xerces-C++ validation inherently splits into two main phases. The initial XSD parsing and compilation is extremely expensive, while the actual validation is very fast.

![Main Steps](docs/images/base.png)

### The Validation Lifecycle

Here is a deeper look into the Xerces architecture and how it processes schemas versus how it validates XML files.

![Xerces Architecture](docs/images/base_diagram.png)

1. **Heavy Phase (One-Time Setup)**: Raw XSD files are scanned, traversed, and compiled into highly optimized DFA (Deterministic Finite Automata) structures. This is stored as the **XML Grammar Pool**.
2. **Light Phase (Every Keystroke)**: The raw XML input is streamed through the pre-compiled Grammar Pool rules using a transient `SAXParser` engine.

## Our Architecture (The Caching Magic)

We utilize WebAssembly linear memory to solve the performance issue of re-parsing heavy XSDs on every validation. 

![Our Architecture](docs/images/our_archi.png)

We completely separate the expensive state from the disposable state:
- **Persistent State**: We compile the schema **once** and lock it inside an `XMLGrammarPool` in the WASM heap. Each workspace project maintains its own isolated pool.
- **Transient Engine**: On every `validate()` call, we spin up a brand new, disposable `SAXParser` engine. It attaches to the existing project grammar pool, validates the XML instantly ($< 1\,\text{ms}$), and destroys itself to guarantee a perfectly clean state.

---

## Quick example

```ts
import { createProjectValidator } from "wso2-synapse-validator";

// 1. Create a validator. This does the heavy lifting: parses XSDs & caches the Grammar Pool in WASM memory.
const v = await createProjectValidator({
  entry: "main.xsd",
  files, // Map of { filename: xsdText }
});

// 2. Validate. Extremely fast. It spins up a transient SAXParser and uses the cached pool.
const result = await v.validate(`<log level="full"/>`);
console.log(result.valid); // true / false

// 3. Destroy to free the C++ allocations from WASM memory to prevent leaks
v.destroy();
```

---

## Setup & Build

Requires Git, Node.js, and an internet connection. Emscripten and Xerces-C are fetched automatically.

```bash
# Clone the repository
git clone --recurse-submodules https://github.com/harshanacz/wso2-synapse-validator

# Install Node dependencies
npm install

# Compile Xerces-C → wasm/xerces_validator.{js,wasm}
# (Downloads the Emscripten toolchain on first run)
npm run build:wasm   

# Compile TypeScript → dist/
npm run build:ts     

# Run the test suite
npm test
```

---

## License

MIT — see [LICENSE](./LICENSE).  
Includes Apache Xerces-C — see [native/xerces-c/LICENSE](native/xerces-c/LICENSE).
