import { getModule, toText } from "./index";
import type {
  XmlInput,
  ProjectFiles,
  ProjectValidatorOptions,
  ProjectValidator,
  ValidationResult,
} from "./types";

async function filesToTextMap(files: ProjectFiles): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(files).map(async ([name, val]) => {
      out[name] = await toText(val);
    })
  );
  return out;
}

export async function createProjectValidator(
  options: ProjectValidatorOptions
): Promise<ProjectValidator> {
  const mod       = await getModule();
  const filesText = await filesToTextMap(options.files);

  if (!(options.entry in filesText)) {
    throw new Error(
      `ProjectValidator: entry "${options.entry}" not found in files`
    );
  }

  const instance = new mod.ProjectValidator();
  const ok = instance.init(
    options.entry,
    filesText,
    options.targetNamespace ?? null
  );

  if (!ok) {
    instance.delete();
    throw new Error(
      `ProjectValidator: failed to compile schema for entry "${options.entry}"`
    );
  }

  let destroyed = false;

  return {
    async validate(xml: XmlInput): Promise<ValidationResult> {
      if (destroyed) throw new Error("ProjectValidator: already destroyed");
      return instance.validate(await toText(xml));
    },

    async updateFile(name: string, content: XmlInput): Promise<void> {
      if (destroyed) throw new Error("ProjectValidator: already destroyed");
      const ok = instance.updateFile(name, await toText(content));
      if (!ok) throw new Error(
        `ProjectValidator: failed to recompile schema after updating "${name}"`
      );
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      instance.delete();
    },
  };
}
