# xerces-wasm

<div align="center">

[![npm version](https://img.shields.io/npm/v/xerces-wasm?style=flat-square&color=cb3837)](https://www.npmjs.com/package/xerces-wasm)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![WebAssembly](https://img.shields.io/badge/Powered%20by-WebAssembly-654ff0?style=flat-square&logo=webassembly&logoColor=white)](https://webassembly.org/)

**XML + XSD validation for Node.js and browsers.**
Powered by Apache Xerces-C compiled to WebAssembly.

</div>

## Installation
```bash
npm install xerces-wasm
```

## Quick Start
```javascript
import { validate } from "xerces-wasm";

const xmlText = "<invoice><amount>100</amount></invoice>";
const xsdText = "<xs:schema>...</xs:schema>";

const result = await validate(xmlText, xsdText);

if (result.valid) {
  console.log("Valid XML");
} else {
  console.log("Syntax Errors:", result.parseErrors);
  console.log("Schema Errors:", result.schemaErrors);
}
```

## Validate Files (Node.js)
```javascript
import { validateFiles } from "xerces-wasm";

const result = await validateFiles("./document.xml", "./schema.xsd");
```

## Multi-Schema Support
If your XSD includes other XSD files, use a schema bundle:
```javascript
const schemaBundle = {
  entry: "./schema/main.xsd",
  imports: {
    "common.xsd": "./schema/common.xsd"
  }
};
const result = await validateFiles("./document.xml", schemaBundle);
```

## License
MIT
