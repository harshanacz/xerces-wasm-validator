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

// Accepted input types for validate()
export type XmlInput = string | Buffer | Blob | File;

let _module: any = null;

async function getModule(): Promise<any> {
  if (!_module) _module = await XercesModule();
  return _module;
}

async function toText(input: XmlInput): Promise<string> {
  if (typeof input === "string") return input;
  if (Buffer.isBuffer(input))   return input.toString("utf8");
  // Blob / File (browser or Node 20+)
  if (typeof Blob !== "undefined" && input instanceof Blob) return input.text();
  throw new TypeError("Unsupported input type");
}

export async function validate(
  xml: XmlInput,
  xsd: XmlInput
): Promise<ValidationResult> {
  const [xmlText, xsdText] = await Promise.all([toText(xml), toText(xsd)]);
  const mod = await getModule();
  return mod.validate(xmlText, xsdText);
}

// Convenience wrapper for file paths (Node.js)
export async function validateFiles(
  xmlPath: string,
  xsdPath: string
): Promise<ValidationResult> {
  const [xml, xsd] = await Promise.all([
    readFile(xmlPath, "utf8"),
    readFile(xsdPath, "utf8"),
  ]);
  const mod = await getModule();
  return mod.validate(xml, xsd);
}
