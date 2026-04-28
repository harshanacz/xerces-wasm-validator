# xerces-wasm

Full XML + XSD schema validation for Node.js and browsers, powered by Apache Xerces-C compiled to WebAssembly.

## Why?

No reliable XSD validator exists in the JS ecosystem. This package brings the gold-standard C++ XML parser to JavaScript via WebAssembly — no native builds, no Java, no Python.

## Install

```bash
npm install xerces-wasm
```

## Usage

```typescript
import { validate } from 'xerces-wasm';

const result = await validate(xmlText, xsdText);

if (result.valid) {
  console.log('Valid');
} else {
  result.parseErrors.forEach(e =>
    console.log(`[SYNTAX] Line ${e.line}: ${e.message}`)
  );
  result.schemaErrors.forEach(e =>
    console.log(`[SCHEMA] Line ${e.line}: ${e.message}`)
  );
}
```

## Returns

```typescript
interface ValidationResult {
  valid:        boolean;
  parseErrors:  Diagnostic[]; // syntax errors
  schemaErrors: Diagnostic[]; // XSD violations
}

interface Diagnostic {
  message:  string;
  line:     number;
  column:   number;
  severity: "warning" | "error" | "fatal";
}
```

## Error behavior

| Scenario | parseErrors | schemaErrors |
|---|---|---|
| Valid XML | `[]` | `[]` |
| Schema violations | `[]` | all violations |
| Syntax error | fatal error | `[]` |
| Schema error before syntax error | fatal error | errors up to crash point |

## Use cases

- Healthcare (HL7/FHIR) — validate clinical XML
- Finance (SWIFT/ISO 20022) — validate financial messages
- VS Code extensions — XML language server validation
- CI/CD pipelines — reject invalid XML before deployment

## License

MIT
