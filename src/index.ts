import { readFile } from "fs/promises";
import * as core from "./core";
// The module's own exports, read when a function runs rather than when it is
// defined, so a replaced export is seen (see setProjectModuleLoader below).
import * as self from "./index";
import type { InitializeOptions, ValidationResult, XmlInput, XsdInput } from "./types";

// These are plain functions, not re-exports, so they stay ordinary writable
// properties of the module as in 2.0.2: code that assigns a replacement, such as
// a test stub, keeps working. A re-export would compile to a read-only getter.

export function getModule(): Promise<any> {
  return core.getModule();
}

export function initialize(options: InitializeOptions = {}): Promise<void> {
  return core.initialize(options);
}

export function toText(input: XmlInput): Promise<string> {
  return core.toText(input);
}

export function validate(
  xml: XmlInput,
  xsd: XsdInput,
  targetNamespace?: string
): Promise<ValidationResult> {
  return core.validate(xml, xsd, targetNamespace);
}

// As in 2.0.2, createProjectValidator() loads the module through the exported
// getModule, so replacing that export changes what it uses.
core.setProjectModuleLoader(() => self.getModule());

// ── File-based validation (Node only) ─────────────────────────────────────────

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
  InitializeOptions,
} from "./types";

export { createProjectValidator } from "./project-validator";
