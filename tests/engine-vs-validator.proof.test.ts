import { promises as fs } from "fs";
import * as path from "path";
import { createProjectValidator, getModule } from "../src/index";

// Loads the schema folder into a relative-path keyed map (same as the mixer test).
const SCHEMA_ROOT = path.join(__dirname, "schemas", "430");

async function readSchemaFolder(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(xsd|dtd|xml)$/.test(entry.name))
        out[path.relative(root, full)] = await fs.readFile(full, "utf8");
    }
  }
  await walk(root);
  return out;
}

const ENTRY = "mediators/mediators.xsd";
const SAMPLE_XML = `<log xmlns="http://ws.apache.org/ns/synapse" level="full"/>`;

describe("PROOF: one shared engine, per-project validators", () => {
  let files: Record<string, string>;
  beforeAll(async () => { files = await readSchemaFolder(SCHEMA_ROOT); });

  // ── Claim 1: the engine (WASM module) is loaded ONCE and shared ───────────
  it("Claim 1 — getModule() always returns the SAME engine instance", async () => {
    const a = await getModule();
    const b = await getModule();
    // Reference equality: not a copy, the very same object.
    expect(a).toBe(b);
  });

  it("Claim 1 — creating MANY validators does NOT create new engines", async () => {
    const engineBefore = await getModule();

    const v1 = await createProjectValidator({ entry: ENTRY, files });
    const v2 = await createProjectValidator({ entry: ENTRY, files });
    const v3 = await createProjectValidator({ entry: ENTRY, files });

    const engineAfter = await getModule();

    // The engine object is byte-for-byte the same reference before and after
    // spinning up 3 validators → no engine was duplicated.
    expect(engineAfter).toBe(engineBefore);

    // The validators themselves are 3 DISTINCT objects (the per-project part).
    expect(v1).not.toBe(v2);
    expect(v2).not.toBe(v3);

    v1.destroy(); v2.destroy(); v3.destroy();
  });

  // ── Claim 2: compile happens ONCE; validate() reuses, does not recompile ──
  it("Claim 2 — validate() is far cheaper than the one-time compile (proves reuse)", async () => {
    const t0 = performance.now();
    const v = await createProjectValidator({ entry: ENTRY, files }); // compiles the pool
    const compileMs = performance.now() - t0;

    const N = 30;
    const t1 = performance.now();
    for (let i = 0; i < N; i++) await v.validate(SAMPLE_XML);       // reuse cached pool
    const perValidateMs = (performance.now() - t1) / N;

    v.destroy();

    // If validate() recompiled the schema each call, per-validate time would be
    // ~compileMs. Reuse means it must be a small fraction of the compile cost.
    console.log(`compile once: ${compileMs.toFixed(1)}ms | avg validate: ${perValidateMs.toFixed(2)}ms`);
    expect(perValidateMs).toBeLessThan(compileMs / 5);
  });

  // ── Claim 3: each validator holds its OWN schema (independent pools) ──────
  it("Claim 3 — two validators with different schemas judge the SAME xml differently", async () => {
    // Validator A: full real schema → <log> is valid.
    const vFull = await createProjectValidator({ entry: ENTRY, files });

    // Validator B: a tiny throwaway schema that only knows <note>, in its own
    // namespace → the same <log> document is NOT valid against it.
    const tinyEntry = "tiny.xsd";
    const vTiny = await createProjectValidator({
      entry: tinyEntry,
      files: {
        [tinyEntry]: `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="urn:tiny" xmlns="urn:tiny"
           elementFormDefault="qualified">
  <xs:element name="note" type="xs:string"/>
</xs:schema>`,
      },
    });

    const resFull = await vFull.validate(SAMPLE_XML);
    const resTiny = await vTiny.validate(SAMPLE_XML);

    // Same engine, same input — different verdicts, because each validator
    // carries its own compiled schema.
    expect(resFull.valid).toBe(true);
    expect(resTiny.valid).toBe(false);

    vFull.destroy(); vTiny.destroy();
  });
});
