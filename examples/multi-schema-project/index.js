const fs = require("fs/promises");
const path = require("path");
const { validateFiles } = require("xerces-wasm");

async function main() {
  const schemaDir = path.join(__dirname, "schema");
  const dataDir = path.join(__dirname, "data");

  const schemaBundle = {
    entry: path.join(schemaDir, "invoice.xsd"),
    imports: {
      "common-types.xsd": path.join(schemaDir, "common-types.xsd"),
      "line-items.xsd": path.join(schemaDir, "line-items.xsd")
    }
  };

  console.log("Validating invoices with xs:include schemas");
  console.log("===========================================\n");

  const files = (await fs.readdir(dataDir)).sort();

  for (const file of files) {
    if (!file.endsWith(".xml")) continue;

    const filePath = path.join(dataDir, file);
    const result = await validateFiles(filePath, schemaBundle);

    if (result.valid) {
      console.log(`${file}: VALID`);
    } else {
      console.log(`${file}: INVALID`);
      for (const error of result.parseErrors) {
        console.log(`  [syntax] ${error.line}:${error.column} ${error.message}`);
      }
      for (const error of result.schemaErrors) {
        console.log(`  [schema] ${error.line}:${error.column} ${error.message}`);
      }
    }

    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
