// @ts-ignore
import XercesModule from "../wasm/xerces_validator.js";
import { readFile } from "fs/promises";
import type { XmlInput, XsdInput, ValidationResult } from "./types";

// ── WASM module singleton ─────────────────────────────────────────────────────

let _module: any = null;

export async function getModule(): Promise<any> {
  if (!_module) _module = await XercesModule();
  return _module;
}

export async function toText(input: XmlInput): Promise<string> {
  if (typeof input === "string") return input;
  if (Buffer.isBuffer(input)) return input.toString("utf8");
  if (typeof Blob !== "undefined" && input instanceof Blob) return input.text();
  throw new TypeError("Unsupported input type");
}

// ── One-off validation ────────────────────────────────────────────────────────

function isSchemaBundle(xsd: XsdInput): xsd is { entry: XmlInput; imports?: Record<string, XmlInput> } {
  return typeof xsd === "object" && !Buffer.isBuffer(xsd) && "entry" in xsd;
}

export async function validate(
  xml: XmlInput,
  xsd: XsdInput,
  targetNamespace?: string
): Promise<ValidationResult> {
  const mod     = await getModule();
  const xmlText = await toText(xml);
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

export async function validateFiles(
  xmlPath: string,
  xsd: string | { entry: string; imports?: Record<string, string> }
): Promise<ValidationResult> {
  const mod = await getModule();

  if (typeof xsd === "string") {
    const [xml, xsdText] = await Promise.all([
      readFile(xmlPath, "utf8"),
      readFile(xsd, "utf8"),
    ]);
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
  return mod.validate(xml, { entry: entryText, imports });
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export type {
  Diagnostic,
  ValidationResult,
  XmlInput,
  XsdInput,
  SchemaBundle,
  ProjectFiles,
  ProjectValidatorOptions,
  ProjectValidator,
} from "./types";

export { createProjectValidator } from "./project-validator";
