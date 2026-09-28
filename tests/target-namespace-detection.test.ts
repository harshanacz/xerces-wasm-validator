import { validate, createProjectValidator } from "../src/index";

// Regression tests for issue #3: targetNamespace auto-detection must accept
// both single- and double-quoted attribute values (and whitespace around '=').

const NS = "urn:example:ns";

function schema(attr: string): string {
  return `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           ${attr}
           elementFormDefault="qualified">
  <xs:element name="root" type="xs:string"/>
</xs:schema>`;
}

const VALID_XML   = `<root xmlns="${NS}">hello</root>`;
const INVALID_XML = `<root xmlns="${NS}"><child/></root>`;

const VARIANTS: Array<[string, string]> = [
  ["double quotes",          `targetNamespace="${NS}"`],
  ["single quotes",          `targetNamespace='${NS}'`],
  ["whitespace around '='",  `targetNamespace = '${NS}'`],
];

describe("targetNamespace auto-detection", () => {
  describe.each(VARIANTS)("%s", (_label, attr) => {
    const xsd = schema(attr);

    it("validate() accepts a matching document", async () => {
      const res = await validate(VALID_XML, xsd);
      expect(res.schemaErrors).toEqual([]);
      expect(res.valid).toBe(true);
    });

    it("validate() rejects a non-matching document", async () => {
      const res = await validate(INVALID_XML, xsd);
      expect(res.valid).toBe(false);
    });

    it("createProjectValidator() accepts a matching document", async () => {
      const v = await createProjectValidator({ entry: "main.xsd", files: { "main.xsd": xsd } });
      try {
        const res = await v.validate(VALID_XML);
        expect(res.schemaErrors).toEqual([]);
        expect(res.valid).toBe(true);
      } finally {
        v.destroy();
      }
    });
  });
});
