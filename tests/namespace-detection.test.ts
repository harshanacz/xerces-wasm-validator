import { createProjectValidator } from "../src/index";

// A schema that declares targetNamespace using SINGLE quotes. This exercises
// the quote-agnostic auto-detection path: with targetNamespace omitted from the
// options, the bridge must read it straight from the XSD text.
const SINGLE_QUOTED_XSD = `<?xml version='1.0' encoding='UTF-8'?>
<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'
           targetNamespace='http://example.com/ns'
           xmlns='http://example.com/ns'
           elementFormDefault='qualified'>
  <xs:element name='note'>
    <xs:complexType>
      <xs:sequence>
        <xs:element name='to' type='xs:string'/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`;

describe("targetNamespace auto-detection", () => {
  it("detects a single-quoted targetNamespace and validates a namespaced document", async () => {
    const validator = await createProjectValidator({
      entry: "note.xsd",
      files: { "note.xsd": SINGLE_QUOTED_XSD },
      // targetNamespace intentionally omitted → forces auto-detection
    });
    try {
      const xml = `<note xmlns='http://example.com/ns'><to>Bob</to></note>`;
      const res = await validator.validate(xml);

      expect(res.parseErrors).toEqual([]);
      expect(res.schemaErrors).toEqual([]);
      expect(res.valid).toBe(true);
    } finally {
      validator.destroy();
    }
  });

  it("still enforces the schema for a single-quoted-namespace XSD", async () => {
    const validator = await createProjectValidator({
      entry: "note.xsd",
      files: { "note.xsd": SINGLE_QUOTED_XSD },
    });
    try {
      // Missing the required <to> child — must be reported as a schema error,
      // proving the schema is actually engaged (not silently treated as no-namespace).
      const xml = `<note xmlns='http://example.com/ns'></note>`;
      const res = await validator.validate(xml);

      expect(res.valid).toBe(false);
      expect(res.schemaErrors.length).toBeGreaterThan(0);
    } finally {
      validator.destroy();
    }
  });
});
