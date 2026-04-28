// eslint-disable-next-line @typescript-eslint/no-require-imports
const XercesModule = require("../wasm/xerces_validator.js");

let mod: any;
beforeAll(async () => {
  mod = await XercesModule();
}, 30000);

function validate(xml: string, xsd: string) {
  return mod.validate(xml, xsd);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMAS — simulating different connector versions
// like WSO2 MI 4.3.0 vs 4.4.0
// ═══════════════════════════════════════════════════════════════════════════════

// Simulates WSO2 MI 4.3.0 Salesforce connector schema
const salesforceV1Xsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='salesforce.query'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='configKey'  type='xs:string'/>
        <xs:element name='queryString' type='xs:string'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// Simulates WSO2 MI 4.4.0 Salesforce connector schema
// — added new required field 'apiVersion'
const salesforceV2Xsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='salesforce.query'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='configKey'   type='xs:string'/>
        <xs:element name='queryString'  type='xs:string'/>
        <xs:element name='apiVersion'   type='xs:decimal'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// Simulates WSO2 MI 4.3.0 HTTP connector schema
const httpV1Xsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='http.get'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='url'     type='xs:string'/>
        <xs:element name='timeout' type='xs:integer'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// Simulates WSO2 MI 4.4.0 HTTP connector schema
// — timeout is now optional, added 'retries'
const httpV2Xsd = `<?xml version='1.0'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'>
  <xs:element name='http.get'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='url'      type='xs:string'/>
        <xs:element name='timeout'  type='xs:integer' minOccurs='0'/>
        <xs:element name='retries'  type='xs:integer' minOccurs='0'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP A — Dynamic Schema Injection (hot-swap)
// Proves connectors can be swapped without restarting
// ═══════════════════════════════════════════════════════════════════════════════

describe("Dynamic Schema Injection (hot-swap connectors)", () => {

  test("v1 schema validates v1 document correctly", () => {
    const xml = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
    </salesforce.query>`;

    const result = validate(xml, salesforceV1Xsd);
    expect(result.valid).toBe(true);
  });

  test("v1 schema rejects v2 document (missing apiVersion in v1 is fine, extra field fails)", () => {
    // v2 doc has apiVersion — v1 schema doesn't allow it
    const xml = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    const result = validate(xml, salesforceV1Xsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("swap to v2 schema — same document now valid", () => {
    // Same XML as above but now validated against v2 schema
    const xml = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    const result = validate(xml, salesforceV2Xsd);
    expect(result.valid).toBe(true);
  });

  test("swap back to v1 schema — same document invalid again", () => {
    const xml = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    // Back to v1
    const result = validate(xml, salesforceV1Xsd);
    expect(result.valid).toBe(false);
  });

  test("hot-swap 10 times alternating schemas — no state leaks", () => {
    const validForV1 = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
    </salesforce.query>`;

    const validForV2 = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    for (let i = 0; i < 10; i++) {
      // v1 schema
      expect(validate(validForV1, salesforceV1Xsd).valid).toBe(true);
      expect(validate(validForV2, salesforceV1Xsd).valid).toBe(false);
      // v2 schema
      expect(validate(validForV2, salesforceV2Xsd).valid).toBe(true);
      expect(validate(validForV1, salesforceV2Xsd).valid).toBe(false);
    }
  });

  test("different connector schemas work independently in same session", () => {
    const sfXml = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
    </salesforce.query>`;

    const httpXml = `<http.get>
      <url>https://api.example.com</url>
      <timeout>5000</timeout>
    </http.get>`;

    // Each validates against its own schema
    expect(validate(sfXml,   salesforceV1Xsd).valid).toBe(true);
    expect(validate(httpXml, httpV1Xsd).valid).toBe(true);

    // Cross-validation should fail
    expect(validate(sfXml,   httpV1Xsd).valid).toBe(false);
    expect(validate(httpXml, salesforceV1Xsd).valid).toBe(false);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP B — Multi-root workspace (side-by-side validators)
// Proves MI 4.3.0 and 4.4.0 projects work simultaneously without conflicts
// ═══════════════════════════════════════════════════════════════════════════════

describe("Multi-root workspace (side-by-side validators)", () => {

  test("MI 4.3.0 and MI 4.4.0 validators run simultaneously without conflict", () => {
    // Workspace 1 — MI 4.3.0 project uses v1 schemas
    const ws1Doc = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
    </salesforce.query>`;

    // Workspace 2 — MI 4.4.0 project uses v2 schemas
    const ws2Doc = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    // Both validate independently and correctly
    const ws1Result = validate(ws1Doc, salesforceV1Xsd);
    const ws2Result = validate(ws2Doc, salesforceV2Xsd);

    expect(ws1Result.valid).toBe(true);
    expect(ws2Result.valid).toBe(true);
  });

  test("MI 4.3.0 workspace correctly rejects MI 4.4.0 document", () => {
    const ws2Doc = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    // MI 4.3.0 validator should reject this
    const result = validate(ws2Doc, salesforceV1Xsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("MI 4.4.0 workspace correctly rejects MI 4.3.0 document", () => {
    // Missing required apiVersion for v2
    const ws1Doc = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
    </salesforce.query>`;

    // MI 4.4.0 validator should reject this
    const result = validate(ws1Doc, salesforceV2Xsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("50 concurrent validations across 2 workspaces — no cross-contamination", () => {
    const ws1Doc = `<http.get>
      <url>https://ws1.example.com</url>
      <timeout>3000</timeout>
    </http.get>`;

    const ws2Doc = `<http.get>
      <url>https://ws2.example.com</url>
    </http.get>`;

    const results = [];

    for (let i = 0; i < 50; i++) {
      if (i % 2 === 0) {
        // Workspace 1 — v1 schema (timeout required)
        results.push({
          ws: 1,
          result: validate(ws1Doc, httpV1Xsd)
        });
      } else {
        // Workspace 2 — v2 schema (timeout optional)
        results.push({
          ws: 2,
          result: validate(ws2Doc, httpV2Xsd)
        });
      }
    }

    // All workspace 1 results should be valid
    results
      .filter(r => r.ws === 1)
      .forEach(r => expect(r.result.valid).toBe(true));

    // All workspace 2 results should be valid
    results
      .filter(r => r.ws === 2)
      .forEach(r => expect(r.result.valid).toBe(true));
  });

  test("schema errors from ws1 do not appear in ws2 results", () => {
    // Invalid doc for ws1
    const invalidWs1Doc = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    // Valid doc for ws2
    const validWs2Doc = `<salesforce.query>
      <configKey>SF_CONFIG</configKey>
      <queryString>SELECT Id FROM Account</queryString>
      <apiVersion>55.0</apiVersion>
    </salesforce.query>`;

    const ws1Result = validate(invalidWs1Doc, salesforceV1Xsd);
    const ws2Result = validate(validWs2Doc,   salesforceV2Xsd);

    // ws1 has errors
    expect(ws1Result.valid).toBe(false);
    expect(ws1Result.schemaErrors.length).toBeGreaterThan(0);

    // ws2 is clean — no contamination from ws1
    expect(ws2Result.valid).toBe(true);
    expect(ws2Result.schemaErrors).toHaveLength(0);
    expect(ws2Result.parseErrors).toHaveLength(0);
  });

  test("HTTP v1 and v2 schemas work independently", () => {
    // v1 requires timeout
    const missingTimeout = `<http.get>
      <url>https://api.example.com</url>
    </http.get>`;

    // v1 should fail (timeout required)
    expect(validate(missingTimeout, httpV1Xsd).valid).toBe(false);

    // v2 should pass (timeout optional)
    expect(validate(missingTimeout, httpV2Xsd).valid).toBe(true);
  });

});
