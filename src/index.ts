// @ts-ignore
import XercesModule from "../wasm/xerces_validator.js";

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

let _module: any = null;

async function getModule(): Promise<any> {
  if (!_module) _module = await XercesModule();
  return _module;
}

export async function validate(
  xmlText: string,
  xsdText: string
): Promise<ValidationResult> {
  const mod = await getModule();
  return mod.validate(xmlText, xsdText);
}
