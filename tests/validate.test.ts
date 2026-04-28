import { validate } from "../src/index";

const xsd = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="person">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="name" type="xs:string"/>
        <xs:element name="age"  type="xs:integer"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

test("valid XML passes", async () => {
  const xml = `<person><name>John</name><age>25</age></person>`;
  const result = await validate(xml, xsd);
  expect(result.valid).toBe(true);
  expect(result.parseErrors).toHaveLength(0);
  expect(result.schemaErrors).toHaveLength(0);
});

test("wrong type returns schema error", async () => {
  const xml = `<person><name>John</name><age>twenty-five</age></person>`;
  const result = await validate(xml, xsd);
  expect(result.valid).toBe(false);
  expect(result.schemaErrors.length).toBeGreaterThan(0);
});

test("malformed XML returns parse error", async () => {
  const xml = `<person><name>John</name`;
  const result = await validate(xml, xsd);
  expect(result.valid).toBe(false);
  expect(result.parseErrors.length).toBeGreaterThan(0);
});
