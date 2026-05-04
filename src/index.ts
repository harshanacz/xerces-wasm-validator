// @ts-ignore
import XercesModule from "../wasm/xerces_validator.js";
import { readFile } from "fs/promises";

export interface Diagnostic {
  message:  string;
  line:     number;
  column:   number;
  severity: "warning" | "error" | "fatal";
}

export interface ValidationResult {
  valid:        boolean;
  parseErrors:  Diagnostic[];
  schemaErrors: Diagnostic[];
}

// A bundle of schemas for xs:import / xs:include support.
// `entry` is the root XSD content.
// `imports` maps relative filenames to their XSD content —
// matching the schemaLocation values used inside the entry schema.
export interface SchemaBundle {
  entry:    XmlInput;
  imports?: Record<string, XmlInput>;
}

export type XmlInput = string | Buffer | Blob | File;
export type XsdInput = XmlInput | SchemaBundle;

let _module: any = null;

async function getModule(): Promise<any> {
  if (!_module) _module = await XercesModule();
  return _module;
}

async function toText(input: XmlInput): Promise<string> {
  if (typeof input === "string") return input;
  if (Buffer.isBuffer(input))   return input.toString("utf8");
  if (typeof Blob !== "undefined" && input instanceof Blob) return input.text();
  throw new TypeError("Unsupported input type");
}

function isSchemaBundle(xsd: XsdInput): xsd is SchemaBundle {
  return typeof xsd === "object" && !Buffer.isBuffer(xsd) && "entry" in xsd;
}

export async function validate(
  xml: XmlInput,
  xsd: XsdInput,
  targetNamespace?: string
): Promise<ValidationResult> {
  const xmlText = await toText(xml);
  const mod     = await getModule();
  const ns      = targetNamespace ?? null;

  if (isSchemaBundle(xsd)) {
    const entryText = await toText(xsd.entry);
    const imports: Record<string, string> = {};
    if (xsd.imports) {
      await Promise.all(
        Object.entries(xsd.imports).map(async ([key, val]) => {
          imports[key] = await toText(val);
        })
      );
    }
    return mod.validate(xmlText, { entry: entryText, imports }, ns);
  }

  return mod.validate(xmlText, await toText(xsd), ns);
}

// Convenience wrapper for Node.js file paths.
// xsd can be a single path or a bundle where each value is a file path.
export async function validateFiles(
  xmlPath: string,
  xsd: string | { entry: string; imports?: Record<string, string> }
): Promise<ValidationResult> {
  if (typeof xsd === "string") {
    const [xml, xsdText] = await Promise.all([
      readFile(xmlPath, "utf8"),
      readFile(xsd, "utf8"),
    ]);
    const mod = await getModule();
    return mod.validate(xml, xsdText);
  }

  const [xml, entryText] = await Promise.all([
    readFile(xmlPath, "utf8"),
    readFile(xsd.entry, "utf8"),
  ]);
  const imports: Record<string, string> = {};
  if (xsd.imports) {
    await Promise.all(
      Object.entries(xsd.imports).map(async ([key, filePath]) => {
        imports[key] = await readFile(filePath, "utf8");
      })
    );
  }
  const mod = await getModule();
  return mod.validate(xml, { entry: entryText, imports });
}
