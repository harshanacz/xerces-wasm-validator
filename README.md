<div align="center">

# xerces-wasm

**High-performance XML Schema (XSD) validation for JavaScript, powered by Apache Xerces-C++ compiled to WebAssembly.**

[![npm version](https://img.shields.io/npm/v/xerces-wasm?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/xerces-wasm)
[![npm downloads](https://img.shields.io/npm/dm/xerces-wasm?style=flat-square&color=blue)](https://www.npmjs.com/package/xerces-wasm)
[![node](https://img.shields.io/node/v/xerces-wasm?style=flat-square&color=339933&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/xerces-wasm?style=flat-square&color=lightgrey)](./LICENSE)

[Installation](#installation) ·
[Quick Start](#quick-start) ·
[API Reference](#api-reference) ·
[Benchmarks](#performance) ·
[Architecture](#architecture) ·
[Playground](https://harshanacz.github.io/xerces-playground/)

</div>

---

## Overview

`xerces-wasm` brings the validation engine of Apache Xerces-C++ to Node.js and the browser. Schemas are compiled once into an in-memory **grammar pool** and reused across every subsequent validation, which removes the per-call schema parsing cost that dominates most WebAssembly XML validators.

### Features

- **Reference-grade validation** — the same Xerces-C++ engine used across the industry, with full XSD 1.0 support.
- **Compile once, validate many** — schemas are cached in WebAssembly memory and reused on every call.
- **Modular schemas** — native support for `xs:include` and `xs:import` across multiple files.
- **Project isolation** — each validator owns its own grammar pool, so identical XML can be valid in one project and invalid in another.
- **Structured diagnostics** — separate well-formedness and schema errors, each with line, column, and severity.
- **Typed API** — ships with TypeScript declarations.

## Installation

```bash
npm install xerces-wasm
```

Requires Node.js 18 or later.

## Quick Start

```ts
import { createProjectValidator } from "xerces-wasm";

// 1. Compile the schemas once. The grammar pool is cached in WASM memory.
const validator = await createProjectValidator({
  entry: "main.xsd",
  files, // Record<string, string>: { filename: xsdText }
});

// 2. Validate as many documents as needed against the cached pool.
const result = await validator.validate(`<log level="full"/>`);

if (!result.valid) {
  for (const e of [...result.parseErrors, ...result.schemaErrors]) {
    console.error(`${e.line}:${e.column} [${e.severity}] ${e.message}`);
  }
}

// 3. Release the native allocations when the validator is no longer needed.
validator.destroy();
```

## API Reference

### `createProjectValidator(options)`

Compiles a set of XSD files into a reusable validator. Recommended for any workload that validates more than one document.

| Option            | Type                        | Description                                                   |
| :---------------- | :-------------------------- | :------------------------------------------------------------ |
| `entry`           | `string`                    | Root XSD filename. Must be a key of `files`.                  |
| `files`           | `Record<string, XmlInput>`  | All schema files, keyed by bare filename.                     |
| `targetNamespace` | `string` *(optional)*       | Target namespace. Detected from the entry schema if omitted.  |

Returns a `ProjectValidator`:

| Method            | Description                                                                          |
| :---------------- | :----------------------------------------------------------------------------------- |
| `validate(xml)`   | Validates a document against the cached grammar pool. Returns `Promise<ValidationResult>`. |
| `reload(files)`   | Recompiles the grammar pool from an updated set of schema files.                     |
| `destroy()`       | Frees the grammar pool and all associated WASM memory.                               |

### `validate(xml, xsd, targetNamespace?)`

One-off validation. The schema is parsed on every call, so prefer `createProjectValidator` for repeated use.
`xsd` accepts a single schema or a bundle: `{ entry, imports? }`.

### `validateFiles(xmlPath, xsd)`

Convenience wrapper that reads the XML and XSD from disk before validating.

### `ValidationResult`

```ts
interface ValidationResult {
  valid: boolean;
  parseErrors: Diagnostic[];   // well-formedness errors
  schemaErrors: Diagnostic[];  // XSD rule violations
}

interface Diagnostic {
  message: string;
  line: number;
  column: number;
  severity: "warning" | "error" | "fatal";
}
```

`XmlInput` accepts `string`, `Buffer`, `Blob`, or `File`.

## Performance

Stateless validators re-parse the schema on every call. `xerces-wasm` parses it once, so per-document cost is limited to validation itself.

The results below compare `xerces-wasm` with [`xmllint-wasm`](https://www.npmjs.com/package/xmllint-wasm), measured on an Apple M4 with Node.js v22 over five interleaved trials.

| Scenario                                 | `xmllint-wasm`    | `xerces-wasm`       | Improvement |
| :--------------------------------------- | ----------------: | ------------------: | ----------: |
| Single schema, warm loop (1,000 runs)    | 22,908 ms         | **41.7 ms**         | 549×        |
| Multi-file modular schema (4 XSDs)       | 23,916 ms         | **69.1 ms**         | 346×        |
| Small payload latency (1.2 KB)           | 23.19 ms / call   | **0.06 ms / call**  | 362×        |
| Medium payload throughput (100 KB)       | 3.59 MB/s         | **34.70 MB/s**      | 9.6×        |
| Schema-invalid XML                       | 24.59 ms / call   | **0.07 ms / call**  | 355×        |
| Memory delta (1,000 runs)                | +2.25 MB          | **+0.41 MB**        | ~5.5× lower |
| 50 parallel validations (`Promise.all`)  | 221.58 ms         | **3.57 ms**         | 62×         |

Methodology and reproducible code: [xml-val-benchmark](https://github.com/harshanacz/xml-val-benchmark).

### Usage guidance

- **Best fit:** services that validate many documents against a fixed set of schemas, such as APIs, message pipelines, and editor tooling.
- **Large documents:** for payloads above roughly 5 MB, validation becomes compute-bound and streaming validators can reach higher throughput.
- **Threading:** validation runs synchronously on the calling thread. For batches of multi-megabyte documents, run validation in a worker thread or background queue.

## Architecture

Xerces-C++ validation has two distinct phases: compiling schemas, which is expensive, and validating documents, which is fast.

![Xerces validation phases](docs/images/base.png)

<img src="docs/images/base_diagram.png" width="300" alt="Xerces validation lifecycle">

1. **Schema compilation (one time).** XSD files are parsed and compiled into DFA structures, stored in an `XMLGrammarPool`.
2. **Validation (per document).** The XML input is streamed through the pre-compiled grammar using a transient `SAXParser`.

`xerces-wasm` separates these concerns explicitly:

![xerces-wasm architecture](docs/images/our_archi.png)

- **Persistent state.** Each project compiles its schemas once into a locked `XMLGrammarPool` in the WASM heap, isolated from all other projects.
- **Transient engine.** Every `validate()` call creates a disposable `SAXParser`, attaches it to the project's pool, validates, and destroys itself.

## Playground

An interactive [browser playground](https://harshanacz.github.io/xerces-playground/) is available for trying the validator without installing anything. Source: [xerces-playground](https://github.com/harshanacz/xerces-playground).

## Development

Requires Git, Node.js, and an internet connection. Emscripten and Xerces-C++ are fetched automatically.

```bash
git clone --recurse-submodules https://github.com/harshanacz/xerces-wasm-validator
cd xerces-wasm-validator

npm install
npm run build:wasm   # Compile Xerces-C++ to wasm/xerces_validator.{js,wasm}
npm run build:ts     # Compile TypeScript to dist/
npm test
```

For reproducible WASM builds, see [docs/reproducible-wasm-build.md](docs/reproducible-wasm-build.md).
Release history is tracked in the [changelog](CHANGELOG.md).

## License

Released under the [MIT License](./LICENSE).

This package includes Apache Xerces-C++, licensed under Apache-2.0. See [LICENSE-APACHE](./LICENSE-APACHE) and [NOTICE](./NOTICE).
