// Entry point for browsers and web workers: the API of the Node entry (index.ts)
// without validateFiles(), which reads from disk. Nothing here imports a Node
// built-in. package.json points browser bundlers at this file.

export { getModule, initialize, toText, validate } from "./core";

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
