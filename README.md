# xerces-wasm

<div align="center">

[![npm version](https://img.shields.io/npm/v/xerces-wasm?style=flat-square&color=cb3837)](https://www.npmjs.com/package/xerces-wasm)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![WebAssembly](https://img.shields.io/badge/Powered%20by-WebAssembly-654ff0?style=flat-square&logo=webassembly&logoColor=white)](https://webassembly.org/)

**Full XML + XSD schema validation for Node.js and browsers.**  
Powered by Apache Xerces-C compiled to WebAssembly — no native builds, no Java, no Python.

</div>

---

## Why xerces-wasm?

No reliable XSD validator exists in the JS ecosystem. `xerces-wasm` brings the gold-standard C++ XML parser to JavaScript via WebAssembly.

- **Battle-tested core** — Apache Xerces-C is used in production by NASA, Apache, and IBM
- **Zero native dependencies** — ships as a `.wasm` binary, works anywhere JS runs
- **Full XSD 1.0 support** — not a subset, not a reimplementation
- **Structured error output** — parse errors and schema violations with line/column info

---

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

---

## Quick Start

```typescript
import { validate } from 'xerces-wasm';

const result = await validate(xmlText, xsdText);

if (result.valid) {
  console.log('Valid!');
} else {
  result.parseErrors.forEach(e =>
    console.error(`[SYNTAX] Line ${e.line}:${e.column} — ${e.message}`)
  );
  result.schemaErrors.forEach(e =>
    console.error(`[SCHEMA] Line ${e.line}:${e.column} — ${e.message}`)
  );
}
```

---

## API

### `validate(xml, xsd)`

```typescript
function validate(xml: string, xsd: string): Promise<ValidationResult>
```

| Parameter | Type     | Description              |
|-----------|----------|--------------------------|
| `xml`     | `string` | XML document to validate |
| `xsd`     | `string` | XSD schema to validate against |

### `ValidationResult`

```typescript
interface ValidationResult {
  valid:        boolean;
  parseErrors:  Diagnostic[];   // XML syntax errors
  schemaErrors: Diagnostic[];   // XSD constraint violations
}

interface Diagnostic {
  message:  string;
  line:     number;
  column:   number;
  severity: 'warning' | 'error' | 'fatal';
}
```

---

## Error Behavior

| Scenario | `parseErrors` | `schemaErrors` |
|---|---|---|
| Valid XML + valid schema | `[]` | `[]` |
| Schema violations only | `[]` | all violations |
| XML syntax error | fatal error | `[]` |
| Schema error before syntax error | fatal error | errors up to crash point |

---

## Use Cases

| Industry | Standard | Example |
|----------|----------|---------|
| Healthcare | HL7 / FHIR | Clinical document validation |
| Finance | SWIFT / ISO 20022 | Financial message validation |
| Developer tools | Any XSD | VS Code XML language server |
| DevOps | Custom schemas | CI/CD pipeline gate |

---

## License

[MIT](./LICENSE) © Harshana Amuwatte
