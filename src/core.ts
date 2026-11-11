// The validator without any Node dependency. The Node entry (index.ts) and the
// browser entry (browser.ts) both build on this file.

// @ts-ignore
import XercesModule from "../wasm/xerces_validator.js";
import type { XmlInput, XsdInput, ValidationResult } from "./types";

// ── WASM module singleton ─────────────────────────────────────────────────────

let _module: any = null;

export async function getModule(): Promise<any> {
  if (!_module) _module = await XercesModule();
  return _module;
}

// Buffer is a Node global. A browser has none, and nothing there can be a Buffer.
function isBuffer(value: unknown): value is Buffer {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(value);
}

export async function toText(input: XmlInput): Promise<string> {
  if (typeof input === "string") return input;
  if (isBuffer(input)) return input.toString("utf8");
  if (typeof Blob !== "undefined" && input instanceof Blob) return input.text();
  throw new TypeError("Unsupported input type");
}

// ── One-off validation ────────────────────────────────────────────────────────

function isSchemaBundle(xsd: XsdInput): xsd is { entry: XmlInput; imports?: Record<string, XmlInput> } {
  return typeof xsd === "object" && !isBuffer(xsd) && "entry" in xsd;
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
