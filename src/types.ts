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
  updateFile(name: string, content: XmlInput): Promise<void>;
  destroy(): void;
}
