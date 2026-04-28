// eslint-disable-next-line @typescript-eslint/no-require-imports
const XercesModule = require("../wasm/xerces_validator.js");

// ── Load WASM once for all tests ──────────────────────────────────────────────
let mod: any;
beforeAll(async () => {
  mod = await XercesModule();
}, 30000);

// ── Helper ────────────────────────────────────────────────────────────────────
function validate(xml: string, xsd: string) {
  return mod.validate(xml, xsd);
}

// ── Base XSD used in most tests ───────────────────────────────────────────────
const personXsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='person'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='name' type='xs:string'/>
        <xs:element name='age'  type='xs:integer'/>
        <xs:element name='email' type='xs:string' minOccurs='0'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — VALID XML
// ═══════════════════════════════════════════════════════════════════════════════

describe("Valid XML", () => {

  test("minimal valid document passes", () => {
    const xml = `<person><name>John</name><age>25</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(true);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.schemaErrors).toHaveLength(0);
  });

  test("valid document with optional element passes", () => {
    const xml = `<person><name>John</name><age>25</age><email>john@example.com</email></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(true);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.schemaErrors).toHaveLength(0);
  });

  test("valid document with whitespace passes", () => {
    const xml = `
      <person>
        <name>John Smith</name>
        <age>30</age>
      </person>
    `;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(true);
  });

  test("valid document with special characters in string passes", () => {
    const xml = `<person><name>John &amp; Jane</name><age>25</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(true);
  });

  test("valid document with negative integer passes", () => {
    const xml = `<person><name>John</name><age>-5</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(true);
  });

  test("valid document with zero age passes", () => {
    const xml = `<person><name>Baby</name><age>0</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(true);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — SCHEMA ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Schema errors", () => {

  test("wrong type returns schema error", () => {
    const xml = `<person><name>John</name><age>twenty-five</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
    expect(result.schemaErrors[0].severity).toBe("error");
  });

  test("schema error contains line number", () => {
    const xml = `<person>\n  <name>John</name>\n  <age>bad-value</age>\n</person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors[0].line).toBeGreaterThan(0);
  });

  test("schema error contains column number", () => {
    const xml = `<person><name>John</name><age>bad</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors[0].column).toBeGreaterThan(0);
  });

  test("schema error contains message string", () => {
    const xml = `<person><name>John</name><age>bad</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors[0].message).toBeTruthy();
    expect(typeof result.schemaErrors[0].message).toBe("string");
  });

  test("missing required element returns schema error", () => {
    const xml = `<person><name>John</name></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("extra unexpected element returns schema error", () => {
    const xml = `<person><name>John</name><age>25</age><phone>123</phone></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("multiple schema errors all returned", () => {
    const xml = `<person><name>John</name><age>bad</age><phone>123</phone></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThanOrEqual(2);
  });

  test("wrong root element returns schema error", () => {
    const xml = `<employee><name>John</name><age>25</age></employee>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("elements in wrong order returns schema error", () => {
    const xml = `<person><age>25</age><name>John</name></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — PARSE / SYNTAX ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Syntax / parse errors", () => {

  test("unclosed tag returns fatal parse error", () => {
    const xml = `<person><name>John</name`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.parseErrors[0].severity).toBe("fatal");
  });

  test("mismatched tags returns parse error", () => {
    const xml = `<person><name>John</age></person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  test("parse error contains line number", () => {
    const xml = `<person>\n<name>John</age>\n</person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors[0].line).toBeGreaterThan(0);
  });

  test("parse error has fatal severity", () => {
    const xml = `<person><name>John</name`;
    const result = validate(xml, personXsd);
    expect(result.parseErrors[0].severity).toBe("fatal");
  });

  test("completely invalid XML returns parse error", () => {
    const xml = `this is not xml at all`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  test("fatal syntax error means schemaErrors is empty", () => {
    const xml = `<person><name>John</name`;
    const result = validate(xml, personXsd);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.schemaErrors).toHaveLength(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — BOTH ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Both schema and parse errors", () => {

  test("schema error before syntax error → both returned", () => {
    // age is wrong type → schema error collected
    // </emai is malformed → fatal parse error stops parsing
    const xml = `<person><name>John</name><age>bad</age><email>x</emai</person>`;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {

  test("empty XML string returns parse error", () => {
    const xml = ``;
    const result = validate(xml, personXsd);
    expect(result.valid).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  test("result always has valid, parseErrors, schemaErrors fields", () => {
    const xml = `<person><name>John</name><age>25</age></person>`;
    const result = validate(xml, personXsd);
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("parseErrors");
    expect(result).toHaveProperty("schemaErrors");
  });

  test("valid is boolean", () => {
    const xml = `<person><name>John</name><age>25</age></person>`;
    const result = validate(xml, personXsd);
    expect(typeof result.valid).toBe("boolean");
  });

  test("parseErrors is array", () => {
    const xml = `<person><name>John</name><age>25</age></person>`;
    const result = validate(xml, personXsd);
    expect(Array.isArray(result.parseErrors)).toBe(true);
  });

  test("schemaErrors is array", () => {
    const xml = `<person><name>John</name><age>25</age></person>`;
    const result = validate(xml, personXsd);
    expect(Array.isArray(result.schemaErrors)).toBe(true);
  });

  test("deeply nested valid XML passes", () => {
    const nestedXsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='root'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='level1'>
          <xs:complexType>
            <xs:sequence>
              <xs:element name='level2' type='xs:string'/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
    const xml = `<root><level1><level2>deep value</level2></level1></root>`;
    const result = validate(xml, nestedXsd);
    expect(result.valid).toBe(true);
  });

  test("XSD with date type validates correctly", () => {
    const xsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='event'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='date' type='xs:date'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
    expect(validate(`<event><date>2024-01-15</date></event>`, xsd).valid).toBe(true);
    expect(validate(`<event><date>not-a-date</date></event>`, xsd).valid).toBe(false);
  });

  test("XSD with boolean type validates correctly", () => {
    const xsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='config'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='enabled' type='xs:boolean'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
    expect(validate(`<config><enabled>true</enabled></config>`, xsd).valid).toBe(true);
    expect(validate(`<config><enabled>false</enabled></config>`, xsd).valid).toBe(true);
    expect(validate(`<config><enabled>yes</enabled></config>`, xsd).valid).toBe(false);
  });

  test("calling validate multiple times works correctly", () => {
    const validXml   = `<person><name>John</name><age>25</age></person>`;
    const invalidXml = `<person><name>John</name><age>bad</age></person>`;
    const r1 = validate(validXml, personXsd);
    const r2 = validate(invalidXml, personXsd);
    const r3 = validate(validXml, personXsd);
    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(false);
    expect(r3.valid).toBe(true);
  });

});
