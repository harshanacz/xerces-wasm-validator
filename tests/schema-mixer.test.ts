import { promises as fs } from "fs";
import * as path from "path";
import { createProjectValidator } from "../src/index";

const GLOBAL_LS_FOLDER = path.join(__dirname, "schemas", "430");

// Reads the global extension schema folder into a relative-path keyed map.
// Keys like "mediators/core/call.xsd" let the WASM resolver reconstruct
// the full virtual URI "memory:///mediators/core/call.xsd", so xs:include
// paths like "../../endpoint.xsd" resolve correctly inside the WASM sandbox.
async function readSchemaFolder(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.(xsd|dtd|xml)$/.test(entry.name)) {
        const rel = path.relative(root, full);
        out[rel] = await fs.readFile(full, "utf8");
      }
    }
  }
  await walk(root);
  return out;
}

// Simulates what the LS does when a user installs a connector:
// generates a connectors.xsd in memory that enumerates the connector elements.
function generateConnectorsXsd(connectorElements: string[]): string {
  const elements = connectorElements
    .map(
      (name) =>
        `    <xs:element name="${name}">` +
        `<xs:complexType><xs:anyAttribute processContents="skip"/></xs:complexType>` +
        `</xs:element>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           elementFormDefault="qualified"
           targetNamespace="http://ws.apache.org/ns/synapse"
           xmlns="http://ws.apache.org/ns/synapse">
  <xs:group name="connectors">
    <xs:choice>
${elements}
      <xs:any namespace="##other" processContents="skip"/>
    </xs:choice>
  </xs:group>
</xs:schema>
`;
}

const CONNECTORS_KEY = "mediators/connectors.xsd";

describe("Schema Mixer — in-memory injection", () => {
  let globalMap: Record<string, string>;

  beforeAll(async () => {
    globalMap = await readSchemaFolder(GLOBAL_LS_FOLDER);
  });

  it("static global map contains the default connectors.xsd placeholder", () => {
    expect(globalMap[CONNECTORS_KEY]).toBeDefined();
    // The default is the empty placeholder — just the xs:any wildcard, no named elements.
    expect(globalMap[CONNECTORS_KEY]).toContain(`name="connectors"`);
  });

  it("injecting a live-generated connectors.xsd overwrites the global placeholder", () => {
    const liveGeneratedXML = generateConnectorsXsd(["s3_getObject", "s3_putObject"]);

    const finalMap = { ...globalMap };
    finalMap[CONNECTORS_KEY] = liveGeneratedXML;

    // The injected string replaced the static one.
    expect(finalMap[CONNECTORS_KEY]).toBe(liveGeneratedXML);
    expect(finalMap[CONNECTORS_KEY]).not.toBe(globalMap[CONNECTORS_KEY]);

    // The injected content contains the live connector elements.
    expect(finalMap[CONNECTORS_KEY]).toContain("s3_getObject");
    expect(finalMap[CONNECTORS_KEY]).toContain("s3_putObject");

    // No new keys were added — same schema set, one entry overridden.
    expect(Object.keys(finalMap).sort()).toEqual(Object.keys(globalMap).sort());
  });

  it("WASM bridge compiles the injected map and validates a sample XML", async () => {
    const liveGeneratedXML = generateConnectorsXsd(["s3_getObject"]);

    const finalMap = { ...globalMap };
    finalMap[CONNECTORS_KEY] = liveGeneratedXML;

    const validator = await createProjectValidator({
      entry: "mediators/mediators.xsd",
      files: finalMap,
    });

    try {
      const xml = `<log xmlns="http://ws.apache.org/ns/synapse" level="full"/>`;
      const result = await validator.validate(xml);

      expect(result.parseErrors).toEqual([]);
      expect(result.schemaErrors).toEqual([]);
      expect(result.valid).toBe(true);
    } finally {
      validator.destroy();
    }
  });
});
