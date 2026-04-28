import path from "path";
import { readFile } from "fs/promises";
import { validate, validateFiles } from "../src/index";

const FIXTURES = path.join(__dirname, "fixtures");
const XML_VALID   = path.join(FIXTURES, "valid.xml");
const XML_INVALID = path.join(FIXTURES, "invalid.xml");
const XSD         = path.join(FIXTURES, "person.xsd");

// ── validateFiles ─────────────────────────────────────────────────────────────

describe("validateFiles", () => {

  test("valid file paths pass", async () => {
    const result = await validateFiles(XML_VALID, XSD);
    expect(result.valid).toBe(true);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.schemaErrors).toHaveLength(0);
  });

  test("invalid xml file returns schema errors", async () => {
    const result = await validateFiles(XML_INVALID, XSD);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("non-existent file rejects with error", async () => {
    await expect(validateFiles("/no/such/file.xml", XSD)).rejects.toThrow();
  });

});

// ── validate() with Buffer ────────────────────────────────────────────────────

describe("validate with Buffer", () => {

  test("Buffer inputs pass for valid xml", async () => {
    const xmlBuf = await readFile(XML_VALID);
    const xsdBuf = await readFile(XSD);
    const result = await validate(xmlBuf, xsdBuf);
    expect(result.valid).toBe(true);
  });

  test("Buffer inputs return schema errors for invalid xml", async () => {
    const xmlBuf = await readFile(XML_INVALID);
    const xsdBuf = await readFile(XSD);
    const result = await validate(xmlBuf, xsdBuf);
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  test("mixed string xsd and Buffer xml works", async () => {
    const xmlBuf = await readFile(XML_VALID);
    const xsdStr = await readFile(XSD, "utf8");
    const result = await validate(xmlBuf, xsdStr);
    expect(result.valid).toBe(true);
  });

});
