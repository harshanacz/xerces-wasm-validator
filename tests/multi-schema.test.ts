import path from "path";
import { readFile } from "fs/promises";
import { validate, validateFiles } from "../src/index";

const FIXTURES = path.join(__dirname, "fixtures");

const mainXsd   = path.join(FIXTURES, "main.xsd");
const typesXsd  = path.join(FIXTURES, "types.xsd");
const xmlValid  = path.join(FIXTURES, "valid.xml");

// ── Inline schemas used for string-based tests ────────────────────────────────

const typesContent = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:simpleType name='EmailType'>
    <xs:restriction base='xs:string'>
      <xs:pattern value='[^@]+@[^@]+\\.[^@]+'/>
    </xs:restriction>
  </xs:simpleType>
  <xs:simpleType name='AgeType'>
    <xs:restriction base='xs:integer'>
      <xs:minInclusive value='0'/>
      <xs:maxInclusive value='150'/>
    </xs:restriction>
  </xs:simpleType>
</xs:schema>`;

const mainContent = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:include schemaLocation='types.xsd'/>
  <xs:element name='person'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='name'  type='xs:string'/>
        <xs:element name='age'   type='AgeType'/>
        <xs:element name='email' type='EmailType' minOccurs='0'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — SchemaBundle via validate()
// ═══════════════════════════════════════════════════════════════════════════════

describe("validate() with SchemaBundle (xs:include)", () => {

  test("valid xml passes against multi-file schema", async () => {
    const result = await validate(
      `<person><name>John</name><age>30</age></person>`,
      { entry: mainContent, imports: { "types.xsd": typesContent } }
    );
    expect(result.valid).toBe(true);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.schemaErrors).toHaveLength(0);
  });

  test("age out of range (AgeType constraint) fails", async () => {
    const result = await validate(
      `<person><name>John</name><age>200</age></person>`,
      { entry: mainContent, imports: { "types.xsd": typesContent } }
    );
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("invalid email pattern fails", async () => {
    const result = await validate(
      `<person><name>John</name><age>30</age><email>not-an-email</email></person>`,
      { entry: mainContent, imports: { "types.xsd": typesContent } }
    );
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("valid email pattern passes", async () => {
    const result = await validate(
      `<person><name>John</name><age>30</age><email>john@example.com</email></person>`,
      { entry: mainContent, imports: { "types.xsd": typesContent } }
    );
    expect(result.valid).toBe(true);
  });

  test("missing import causes schema error (type AgeType unknown)", async () => {
    // Pass entry without the import — Xerces can't resolve types.xsd
    const result = await validate(
      `<person><name>John</name><age>30</age></person>`,
      { entry: mainContent }   // no imports
    );
    // Without the import, AgeType is undefined → schema error
    expect(result.valid).toBe(false);
  });

  test("bundle with Buffer entry works", async () => {
    const entryBuf = Buffer.from(mainContent, "utf8");
    const result = await validate(
      `<person><name>John</name><age>30</age></person>`,
      { entry: entryBuf, imports: { "types.xsd": typesContent } }
    );
    expect(result.valid).toBe(true);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — validateFiles() with multi-schema bundle
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateFiles() with multi-schema bundle", () => {

  test("valid xml file passes against multi-file schema on disk", async () => {
    const result = await validateFiles(xmlValid, {
      entry: mainXsd,
      imports: { "types.xsd": typesXsd },
    });
    expect(result.valid).toBe(true);
  });

  test("missing import file rejects with error", async () => {
    await expect(
      validateFiles(xmlValid, {
        entry: mainXsd,
        imports: { "types.xsd": "/no/such/file.xsd" },
      })
    ).rejects.toThrow();
  });

  test("multi-level nested schema works propertly", async () => {
    const deepMain = path.join(FIXTURES, "deep-main.xsd");
    const midTypes = path.join(FIXTURES, "mid-types.xsd");
    const deepTypes = path.join(FIXTURES, "deep-types.xsd");
    
    // valid.xml matches deep-main.xsd elements as well
    const result = await validateFiles(xmlValid, {
      entry: deepMain,
      imports: { 
        "mid-types.xsd": midTypes,
        "deep-types.xsd": deepTypes
      },
    });
    expect(result.valid).toBe(true);
  });

});
