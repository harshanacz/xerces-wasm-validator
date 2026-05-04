# xerces-wasm

<div align="center">

[![npm version](https://img.shields.io/npm/v/xerces-wasm?style=flat-square&color=cb3837)](https://www.npmjs.com/package/xerces-wasm)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![WebAssembly](https://img.shields.io/badge/Powered%20by-WebAssembly-654ff0?style=flat-square&logo=webassembly&logoColor=white)](https://webassembly.org/)

**Full XML + XSD schema validation for Node.js and browsers.**  
Powered by Apache Xerces-C compiled to WebAssembly.

[Documentation site](./docs/) · [Example project](./example-project/) · [Issues](https://github.com/harshanacz/xerces-wasm/issues)

</div>

---

## Current Package Data

Verified against `package.json` and the npm registry on **2026-05-04**.

| Field | Value |
| --- | --- |
| Package | `xerces-wasm` |
| Version | `0.2.0` |
| Description | XML + XSD validation via Xerces-C compiled to WebAssembly |
| Main entry | `dist/index.js` |
| Type declarations | `dist/index.d.ts` |
| Runtime npm dependencies | `0` |
| License | `MIT` |
| Repository | `https://github.com/harshanacz/xerces-wasm` |
| Published homepage | `https://github.com/harshanacz/xerces-wasm#readme` |

## Why xerces-wasm?

JavaScript projects often need real XSD validation without installing native parsers on every machine. `xerces-wasm` wraps the Apache Xerces-C validation engine behind a small TypeScript API and ships the parser as WebAssembly.

- **XML + XSD validation** with separate syntax and schema diagnostics
- **WebAssembly runtime** with no native install step for consumers
- **Schema bundles** for `xs:include` and `xs:import`
- **Namespace-aware validation** with auto-detected or explicit target namespaces
- **Multiple input types** including strings, Buffers, Blobs, Files, and Node.js file paths
- **Structured errors** with message, severity, line, and column

## Installation

```bash
npm install xerces-wasm
```

```bash
yarn add xerces-wasm
```

```bash
pnpm add xerces-wasm
```

## Quick Start

### Validate strings

```typescript
import { validate } from "xerces-wasm";

const result = await validate(xmlText, xsdText);

if (result.valid) {
  console.log("Valid XML");
} else {
  for (const error of result.parseErrors) {
    console.error(`[SYNTAX] ${error.line}:${error.column} ${error.message}`);
  }

  for (const error of result.schemaErrors) {
    console.error(`[SCHEMA] ${error.line}:${error.column} ${error.message}`);
  }
}
```

### Validate files in Node.js

```typescript
import { validateFiles } from "xerces-wasm";

const result = await validateFiles("./document.xml", "./schema.xsd");
```

### Validate Buffers, Blobs, or Files

```typescript
import { readFile } from "fs/promises";
import { validate } from "xerces-wasm";

const xml = await readFile("./document.xml");
const xsd = await readFile("./schema.xsd");

const result = await validate(xml, xsd);
```

### Validate multi-file schemas

Pass imports keyed by the same `schemaLocation` values used inside the entry XSD.

```typescript
import { validate, validateFiles } from "xerces-wasm";

const fromStrings = await validate(xmlText, {
  entry: mainXsdText,
  imports: {
    "types.xsd": typesXsdText,
    "common.xsd": commonXsdText
  }
});

const fromFiles = await validateFiles("./document.xml", {
  entry: "./schemas/main.xsd",
  imports: {
    "types.xsd": "./schemas/types.xsd",
    "common.xsd": "./schemas/common.xsd"
  }
});
```

### Override the target namespace

When omitted, `targetNamespace` is read from the entry XSD. Pass it explicitly when a schema is served without that attribute or a caller needs to override it.

```typescript
import { validate } from "xerces-wasm";

const result = await validate(
  xmlText,
  xsdText,
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
);
```

## API

### `validate(xml, xsd, targetNamespace?)`

```typescript
type XmlInput = string | Buffer | Blob | File;

interface SchemaBundle {
  entry: XmlInput;
  imports?: Record<string, XmlInput>;
}

type XsdInput = XmlInput | SchemaBundle;

function validate(
  xml: XmlInput,
  xsd: XsdInput,
  targetNamespace?: string
): Promise<ValidationResult>;
```

### `validateFiles(xmlPath, xsd)`

```typescript
function validateFiles(
  xmlPath: string,
  xsd: string | { entry: string; imports?: Record<string, string> }
): Promise<ValidationResult>;
```

### `ValidationResult`

```typescript
interface ValidationResult {
  valid: boolean;
  parseErrors: Diagnostic[];
  schemaErrors: Diagnostic[];
}

interface Diagnostic {
  message: string;
  line: number;
  column: number;
  severity: "warning" | "error" | "fatal";
}
```

## Error Behavior

| Scenario | `parseErrors` | `schemaErrors` |
| --- | --- | --- |
| Valid XML + valid schema | `[]` | `[]` |
| Schema violations only | `[]` | One or more schema diagnostics |
| XML syntax error | One or more fatal syntax diagnostics | May include fatal diagnostics reported by the native validator |
| Schema error before syntax error | Fatal syntax diagnostics | Diagnostics collected before the parser stopped |

## Development

```bash
npm install
npm test
npm run build
```

The static documentation website lives in `docs/` and can be opened directly from `docs/index.html` or served by GitHub Pages.

## Standalone Project Example

The `example-project/` directory contains a complete invoice validation example that consumes `xerces-wasm` as an npm dependency.

```bash
cd example-project
npm install
npm start
```

## Use Cases

| Area | Example |
| --- | --- |
| Healthcare | HL7 / FHIR document validation |
| Finance | SWIFT and ISO 20022 message validation |
| Developer tools | XML language servers, editors, and CI diagnostics |
| DevOps | Schema validation gates in build pipelines |
| Integration platforms | Versioned connector schema validation |

## License

[MIT](./LICENSE) 
