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

export type XmlInput = string | Buffer | Blob | File;

// One-off schema input — single XSD or a bundle for xs:include / xs:import
export interface SchemaBundle {
  entry:    XmlInput;
  imports?: Record<string, XmlInput>;
}
export type XsdInput = XmlInput | SchemaBundle;

// Project validator — all XSD files the schema needs, keyed by bare filename
export interface ProjectFiles {
  [filename: string]: XmlInput;
}

export interface ProjectValidatorOptions {
  entry:            string;       // root XSD filename — must be a key in files
  files:            ProjectFiles;
  targetNamespace?: string;       // auto-detected from entry XSD if omitted
}

export interface ProjectValidator {
  validate(xml: XmlInput): Promise<ValidationResult>;
  // Re-read all schema files from disk and recompile the pool.
  // Call when connectors.xsd is regenerated after a connector download.
  reload(files: ProjectFiles): Promise<void>;
  destroy(): void;
}

// How the WebAssembly module is loaded. See initialize().
export interface InitializeOptions {
  // The contents of xerces_validator.wasm. When given, the file is not read or fetched.
  wasmBinary?: ArrayBuffer | Uint8Array;
  // Returns the path or URL of a file the module needs. `file` is
  // "xerces_validator.wasm"; `scriptDirectory` is where the module would look by default.
  locateFile?: (file: string, scriptDirectory: string) => string;
}
