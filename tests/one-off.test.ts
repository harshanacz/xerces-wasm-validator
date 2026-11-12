import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { createProjectValidator, toText, validate, validateFiles } from "../src/index";

const XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence><xs:element name="quantity" type="xs:positiveInteger"/></xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
const VALID = `<order id="a1"><quantity>3</quantity></order>`;
const INVALID = `<order><quantity>many</quantity></order>`;
const MALFORMED = `<order id="a1"><quantity>3</order>`;

// A schema split over two files: the entry includes the type it uses.
const BUNDLE_ENTRY = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:include schemaLocation="types.xsd"/>
  <xs:element name="order" type="OrderType"/>
</xs:schema>`;
const BUNDLE_TYPES = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:complexType name="OrderType">
    <xs:sequence><xs:element name="quantity" type="xs:positiveInteger"/></xs:sequence>
  </xs:complexType>
</xs:schema>`;
const BUNDLE_VALID = `<order><quantity>3</quantity></order>`;
const BUNDLE_INVALID = `<order><quantity>-1</quantity></order>`;

const NS_XSD = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:shop" xmlns="urn:shop" elementFormDefault="qualified">
  <xs:element name="item" type="xs:int"/>
</xs:schema>`;

describe("validate", () => {
  it("accepts a valid document", async () => {
    expect(await validate(VALID, XSD)).toEqual({ valid: true, parseErrors: [], schemaErrors: [] });
  });

  it("reports schema errors with a position and severity", async () => {
    const result = await validate(INVALID, XSD);
    expect(result.valid).toBe(false);
    expect(result.parseErrors).toEqual([]);
    expect(result.schemaErrors.length).toBeGreaterThanOrEqual(2);
    for (const error of result.schemaErrors) {
      expect(typeof error.message).toBe("string");
      expect(error.line).toBeGreaterThan(0);
      expect(error.column).toBeGreaterThan(0);
      expect(["warning", "error", "fatal"]).toContain(error.severity);
    }
    expect(result.schemaErrors.some((e) => e.message.includes("id"))).toBe(true);
  });

  it("reports a malformed document as parse errors", async () => {
    const result = await validate(MALFORMED, XSD);
    expect(result.valid).toBe(false);
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  it("takes the document and the schema as a Buffer", async () => {
    expect((await validate(Buffer.from(VALID), Buffer.from(XSD))).valid).toBe(true);
    expect((await validate(Buffer.from(INVALID), Buffer.from(XSD))).valid).toBe(false);
  });

  it("takes the document and the schema as a Blob", async () => {
    expect((await validate(new Blob([VALID]), new Blob([XSD]))).valid).toBe(true);
    expect((await validate(new Blob([INVALID]), new Blob([XSD]))).valid).toBe(false);
  });

  it("resolves xs:include through a schema bundle", async () => {
    const xsd = { entry: BUNDLE_ENTRY, imports: { "types.xsd": BUNDLE_TYPES } };
    expect((await validate(BUNDLE_VALID, xsd)).valid).toBe(true);
    const result = await validate(BUNDLE_INVALID, xsd);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  it("takes the files of a schema bundle as Buffers", async () => {
    const xsd = { entry: Buffer.from(BUNDLE_ENTRY), imports: { "types.xsd": Buffer.from(BUNDLE_TYPES) } };
    expect((await validate(BUNDLE_VALID, xsd)).valid).toBe(true);
    expect((await validate(BUNDLE_INVALID, xsd)).valid).toBe(false);
  });

  it("validates against a schema with a target namespace", async () => {
    expect((await validate(`<item xmlns="urn:shop">4</item>`, NS_XSD, "urn:shop")).valid).toBe(true);
    expect((await validate(`<item xmlns="urn:shop">four</item>`, NS_XSD, "urn:shop")).valid).toBe(false);
  });

  it("gives the same result on repeated and concurrent calls", async () => {
    const results = await Promise.all([validate(VALID, XSD), validate(INVALID, XSD), validate(VALID, XSD)]);
    expect(results.map((r) => r.valid)).toEqual([true, false, true]);
    expect(await validate(INVALID, XSD)).toEqual(results[1]);
  });
});

describe("validateFiles", () => {
  let dir: string;
  const file = (name: string) => path.join(dir, name);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "xerces-wasm-"));
    await Promise.all([
      fs.writeFile(file("order.xsd"), XSD),
      fs.writeFile(file("valid.xml"), VALID),
      fs.writeFile(file("invalid.xml"), INVALID),
      fs.writeFile(file("entry.xsd"), BUNDLE_ENTRY),
      fs.writeFile(file("types.xsd"), BUNDLE_TYPES),
      fs.writeFile(file("bundle-valid.xml"), BUNDLE_VALID),
      fs.writeFile(file("bundle-invalid.xml"), BUNDLE_INVALID),
    ]);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads the document and a single schema from disk", async () => {
    expect((await validateFiles(file("valid.xml"), file("order.xsd"))).valid).toBe(true);
    const result = await validateFiles(file("invalid.xml"), file("order.xsd"));
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  it("reads a schema bundle from disk", async () => {
    const xsd = { entry: file("entry.xsd"), imports: { "types.xsd": file("types.xsd") } };
    expect((await validateFiles(file("bundle-valid.xml"), xsd)).valid).toBe(true);
    expect((await validateFiles(file("bundle-invalid.xml"), xsd)).valid).toBe(false);
  });

  it("rejects when a file does not exist", async () => {
    await expect(validateFiles(file("missing.xml"), file("order.xsd"))).rejects.toThrow(/ENOENT/);
    await expect(validateFiles(file("valid.xml"), file("missing.xsd"))).rejects.toThrow(/ENOENT/);
  });
});

describe("toText", () => {
  it("returns a string unchanged", async () => {
    expect(await toText("<a/>")).toBe("<a/>");
  });

  it("decodes a Buffer and a Blob as UTF-8", async () => {
    expect(await toText(Buffer.from("<a>é</a>", "utf8"))).toBe("<a>é</a>");
    expect(await toText(new Blob(["<a>é</a>"]))).toBe("<a>é</a>");
  });

  it("rejects other input types", async () => {
    await expect(toText(42 as any)).rejects.toThrow(TypeError);
    await expect(toText({} as any)).rejects.toThrow("Unsupported input type");
  });
});

describe("createProjectValidator input types", () => {
  it("takes schema files and documents as Buffers and Blobs", async () => {
    const validator = await createProjectValidator({
      entry: "entry.xsd",
      files: { "entry.xsd": Buffer.from(BUNDLE_ENTRY), "types.xsd": new Blob([BUNDLE_TYPES]) },
    });
    try {
      expect((await validator.validate(Buffer.from(BUNDLE_VALID))).valid).toBe(true);
      expect((await validator.validate(new Blob([BUNDLE_INVALID]))).valid).toBe(false);
    } finally {
      validator.destroy();
    }
  });
});
