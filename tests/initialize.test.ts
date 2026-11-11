import * as fs from "fs";
import * as path from "path";

const WASM_PATH = path.join(__dirname, "..", "wasm", "xerces_validator.wasm");
const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="n" type="xs:int"/></xs:schema>`;

type Api = typeof import("../src/index");

// Each test gets its own copy of the package, so the module is not loaded yet.
function freshApi(): Api {
  let api!: Api;
  jest.isolateModules(() => {
    api = require("../src/index");
  });
  return api;
}

async function expectValidatorWorks(api: Api): Promise<void> {
  expect((await api.validate("<n>1</n>", XSD)).valid).toBe(true);
  expect((await api.validate("<n>one</n>", XSD)).valid).toBe(false);
}

describe("initialize", () => {
  it("is optional: the module loads on first use", async () => {
    await expectValidatorWorks(freshApi());
  });

  it("loads the module with the defaults when given no options", async () => {
    const api = freshApi();
    await expect(api.initialize()).resolves.toBeUndefined();
    await expectValidatorWorks(api);
  });

  it.each([
    ["a Buffer", () => fs.readFileSync(WASM_PATH)],
    ["a Uint8Array", () => new Uint8Array(fs.readFileSync(WASM_PATH))],
    ["an ArrayBuffer", () => {
      const bytes = fs.readFileSync(WASM_PATH);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    }],
  ])("takes the WebAssembly file as %s, without looking for it", async (_label, read) => {
    const api = freshApi();
    const locateFile = jest.fn(() => path.join(__dirname, "no-such-folder", "xerces_validator.wasm"));
    await api.initialize({ wasmBinary: read(), locateFile });
    await expectValidatorWorks(api);
  });

  it("asks locateFile where the WebAssembly file is", async () => {
    const api = freshApi();
    const locateFile = jest.fn((_file: string, _scriptDirectory: string) => WASM_PATH);
    await api.initialize({ locateFile });
    expect(locateFile).toHaveBeenCalledWith("xerces_validator.wasm", expect.any(String));
    await expectValidatorWorks(api);
  });

  it("loads the module once: getModule() returns the same instance every time", async () => {
    const api = freshApi();
    const [a, b] = await Promise.all([api.getModule(), api.getModule()]);
    expect(a).toBe(b);
    expect(await api.getModule()).toBe(a);
  });

  it("rejects when called a second time", async () => {
    const api = freshApi();
    await api.initialize();
    await expect(api.initialize()).rejects.toThrow("already loaded or loading");
    await expectValidatorWorks(api);
  });

  it("rejects when the module was already loaded by a validation", async () => {
    const api = freshApi();
    await api.validate("<n>1</n>", XSD);
    await expect(api.initialize({ wasmBinary: fs.readFileSync(WASM_PATH) })).rejects.toThrow("already loaded or loading");
  });

  it("rejects while an earlier load is still in flight", async () => {
    const api = freshApi();
    const first = api.initialize();
    await expect(api.initialize()).rejects.toThrow("already loaded or loading");
    await first;
  });

  it("can be called again after a failed load", async () => {
    const api = freshApi();
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(api.initialize({ wasmBinary: new Uint8Array([0, 1, 2, 3]) })).rejects.toBeDefined();
    } finally {
      quiet.mockRestore();
    }
    await api.initialize({ wasmBinary: fs.readFileSync(WASM_PATH) });
    await expectValidatorWorks(api);
  });

  it("recovers on the next validation after a failed load", async () => {
    const api = freshApi();
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(api.initialize({ wasmBinary: new Uint8Array([0, 1, 2, 3]) })).rejects.toBeDefined();
    } finally {
      quiet.mockRestore();
    }
    await expectValidatorWorks(api);
  });

  it("shares the loaded module with createProjectValidator", async () => {
    const api = freshApi();
    await api.initialize({ wasmBinary: fs.readFileSync(WASM_PATH) });
    const validator = await api.createProjectValidator({ entry: "n.xsd", files: { "n.xsd": XSD } });
    try {
      expect((await validator.validate("<n>1</n>")).valid).toBe(true);
      expect((await validator.validate("<n>one</n>")).valid).toBe(false);
    } finally {
      validator.destroy();
    }
  });
});
