// The validator without any Node dependency. The Node entry (index.ts) and the
// browser entry (browser.ts) both build on this file.

// @ts-ignore
import XercesModule from "../wasm/xerces_validator.js";
import type { XmlInput, XsdInput, ValidationResult, InitializeOptions } from "./types";

// ── WASM module singleton ─────────────────────────────────────────────────────

let _module: Promise<any> | null = null;

function loadModule(options: InitializeOptions): Promise<any> {
  const moduleArg: Record<string, unknown> = {};
  if (options.wasmBinary) moduleArg.wasmBinary = options.wasmBinary;
  if (options.locateFile) moduleArg.locateFile = options.locateFile;

  const pending: Promise<any> = XercesModule(moduleArg);
  _module = pending;
  // A failed load must not stick: the next call tries again.
  pending.catch(() => {
    if (_module === pending) _module = null;
  });
  return pending;
}

/** Returns the WebAssembly module, loading it on first use. */
export function getModule(): Promise<any> {
  return _module ?? loadModule({});
}

// The loader createProjectValidator() uses. The Node entry points it at its own
// exported getModule, as in 2.0.2, so code that replaces that export (a test
// double, for example) changes what createProjectValidator() loads as well.
let projectModuleLoader: () => Promise<any> = getModule;

export function setProjectModuleLoader(loader: () => Promise<any>): void {
  projectModuleLoader = loader;
}

export function loadModuleForProject(): Promise<any> {
  return projectModuleLoader();
}

/**
 * Loads the WebAssembly module with the given options. Optional: without it the
 * module loads on first use and looks for `xerces_validator.wasm` next to the
 * script. Call it once, before any validation, to say where the file comes from.
 */
export async function initialize(options: InitializeOptions = {}): Promise<void> {
  if (_module) {
    throw new Error(
      "xerces-wasm: the WebAssembly module is already loaded or loading. " +
      "Call initialize() once, before any validation."
    );
  }
  await loadModule(options);
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
