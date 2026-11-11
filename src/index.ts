import { readFile } from "fs/promises";
import { getModule } from "./core";
import type { ValidationResult } from "./types";

export { getModule, initialize, toText, validate } from "./core";

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
