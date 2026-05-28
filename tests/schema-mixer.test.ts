import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { createProjectValidator } from "../src/index";

const GLOBAL_LS_FOLDER = path.join(__dirname, "schemas", "430");

// Build a flat map keyed by the file's relative path from `root`.
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

describe("Schema Mixer — Global LS + User Project merge", () => {
  // Marker the user-project copy of connectors.xsd carries so we can prove
  // which version survived into the final map.
  const USER_CONNECTORS_MARKER = "USER_PROJECT_CONNECTORS_MARKER_v9_9_9";

  const USER_CONNECTORS_XSD = `<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           elementFormDefault="qualified"
           targetNamespace="http://ws.apache.org/ns/synapse"
           xmlns="http://ws.apache.org/ns/synapse">
  <!-- ${USER_CONNECTORS_MARKER} -->
  <xs:group name="connectors">
    <xs:choice>
      <xs:any namespace="##other" processContents="skip"/>
    </xs:choice>
  </xs:group>
</xs:schema>
`;

  // The override must use the same relative-path key as the global map entry.
  // In the 430 tree that is "mediators/connectors.xsd".
  const CONNECTORS_KEY = "mediators/connectors.xsd";

  let userProjectFolder: string;

  beforeAll(async () => {
    userProjectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "user-proj-"));
    const mediatorsDir = path.join(userProjectFolder, "mediators");
    await fs.mkdir(mediatorsDir, { recursive: true });
    await fs.writeFile(
      path.join(mediatorsDir, "connectors.xsd"),
      USER_CONNECTORS_XSD,
      "utf8"
    );
  });

  afterAll(async () => {
    await fs.rm(userProjectFolder, { recursive: true, force: true });
  });

  it("user project's connectors.xsd overrides the global one in the merged map", async () => {
    const globalMap  = await readSchemaFolder(GLOBAL_LS_FOLDER);
    const projectMap = await readSchemaFolder(userProjectFolder);

    expect(globalMap[CONNECTORS_KEY]).toBeDefined();
    expect(projectMap[CONNECTORS_KEY]).toBeDefined();
    expect(globalMap[CONNECTORS_KEY]).not.toContain(USER_CONNECTORS_MARKER);
    expect(projectMap[CONNECTORS_KEY]).toContain(USER_CONNECTORS_MARKER);

    const finalMap = { ...globalMap, ...projectMap };

    expect(finalMap[CONNECTORS_KEY]).toBe(projectMap[CONNECTORS_KEY]);
    expect(finalMap[CONNECTORS_KEY]).not.toBe(globalMap[CONNECTORS_KEY]);
    expect(finalMap[CONNECTORS_KEY]).toContain(USER_CONNECTORS_MARKER);

    // Project only contributed connectors.xsd, so merged key count equals global.
    expect(Object.keys(finalMap).sort()).toEqual(Object.keys(globalMap).sort());
  });

  it("createProjectValidator compiles the merged map and validates a sample XML", async () => {
    const globalMap  = await readSchemaFolder(GLOBAL_LS_FOLDER);
    const projectMap = await readSchemaFolder(userProjectFolder);
    const finalMap   = { ...globalMap, ...projectMap };

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
