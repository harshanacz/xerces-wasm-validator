// @ts-ignore
import XercesModule from "../wasm/xerces_validator.js";
import { readFile } from "fs/promises";
import type { XmlInput, XsdInput, UrlInput, ValidationResult } from "./types";

// ── WASM module singleton ─────────────────────────────────────────────────────

let _module: any = null;

export async function getModule(): Promise<any> {
  if (!_module) _module = await XercesModule();
  return _module;
}

function isUrlInput(input: unknown): input is UrlInput {
  return (
    typeof input === "object" &&
    input !== null &&
    !Buffer.isBuffer(input) &&
    !(typeof Blob !== "undefined" && input instanceof Blob) &&
    typeof (input as UrlInput).url === "string"
  );
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

// Fetches a URL-wrapped input. Opt-in: only triggered when the caller
// explicitly passes { url }, never for a plain string. Uses the platform
// `fetch`, so it works unmodified in both Node (>=18) and browsers.
async function fetchText(input: UrlInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(input.url, {
      headers: input.headers,
      signal:  controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch "${input.url}": HTTP ${res.status} ${res.statusText}`
      );
    }
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Failed to fetch "${input.url}": timed out after ${timeoutMs}ms`);
    }
    if (err instanceof Error && err.message.startsWith("Failed to fetch")) throw err;
    throw new Error(`Failed to fetch "${input.url}": ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function toText(input: XmlInput): Promise<string> {
  if (typeof input === "string") return input;
  if (Buffer.isBuffer(input)) return input.toString("utf8");
  if (typeof Blob !== "undefined" && input instanceof Blob) return input.text();
  if (isUrlInput(input)) return fetchText(input);
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
  UrlInput,
  SchemaBundle,
  ProjectFiles,
  ProjectValidatorOptions,
  ProjectValidator,
} from "./types";

export { createProjectValidator } from "./project-validator";
