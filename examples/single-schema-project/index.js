const fs = require("fs/promises");
const path = require("path");
// This simulates importing from "node_modules/xerces-wasm" normally
const { validateFiles } = require("xerces-wasm");

async function main() {
  const schemaPath = path.join(__dirname, "schema", "invoice.xsd");
  const dataDir = path.join(__dirname, "data");

  console.log("🧾 Validating Invoices...");
  console.log("=========================\n");

  const files = (await fs.readdir(dataDir)).sort();

  for (const file of files) {
    if (!file.endsWith('.xml')) continue;
    const filePath = path.join(dataDir, file);
    
    try {
      const result = await validateFiles(filePath, schemaPath);
      if (result.valid) {
        console.log(`✅ ${file}: VALID`);
      } else {
        console.log(`❌ ${file}: INVALID`);
        for (const error of result.schemaErrors) {
          console.log(`   Line ${error.line}, Col ${error.column}: ${error.message}`);
        }
      }
    } catch (e) {
      console.log(`⚠️ ${file}: FATAL ERROR - ${e.message}`);
    }
    console.log("");
  }
}

main().catch(console.error);
