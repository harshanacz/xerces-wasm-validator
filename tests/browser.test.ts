import { build } from "esbuild";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

const ROOT = path.join(__dirname, "..");
const WASM = fs.readFileSync(path.join(ROOT, "wasm", "xerces_validator.wasm"));

const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="n" type="xs:int"/></xs:schema>`;
const ENTRY = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:include schemaLocation="types.xsd"/><xs:element name="order" type="OrderType"/></xs:schema>`;
const TYPES = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:complexType name="OrderType"><xs:sequence><xs:element name="quantity" type="xs:positiveInteger"/></xs:sequence></xs:complexType></xs:schema>`;

async function bundleForBrowser(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "xercesWasm",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

type Scope = Record<string, any>;

/** The globals a browser has that the validator needs. No process, Buffer, require or module. */
function browserGlobals(fetched: string[], fetchImpl?: (url: string) => Promise<Response>): Scope {
  return {
    console,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    URL,
    Blob,
    fetch: async (url: unknown) => {
      fetched.push(String(url));
      if (fetchImpl) return fetchImpl(String(url));
      return new Response(WASM, { headers: { "content-type": "application/wasm" } });
    },
  };
}

/** A scope that looks like a web worker whose script is at `scriptUrl`. */
function workerScope(scriptUrl: string, fetched: string[], fetchImpl?: (url: string) => Promise<Response>): Scope {
  const scope = browserGlobals(fetched, fetchImpl);
  scope.WorkerGlobalScope = function WorkerGlobalScope() {};
  scope.location = { href: scriptUrl };
  scope.self = scope;
  return scope;
}

/** A scope that looks like a page that loaded the script from `scriptUrl`. */
function windowScope(scriptUrl: string, fetched: string[]): Scope {
  const scope = browserGlobals(fetched);
  scope.document = { currentScript: { src: scriptUrl } };
  scope.window = scope;
  scope.self = scope;
  return scope;
}

function load(code: string, scope: Scope): any {
  vm.createContext(scope);
  vm.runInContext(code, scope);
  return scope.xercesWasm;
}

// Results come from another realm; compare them as plain data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function expectValidatorWorks(api: any): Promise<void> {
  expect(plain(await api.validate("<n>1</n>", XSD))).toEqual({ valid: true, parseErrors: [], schemaErrors: [] });
  const bad = plain(await api.validate("<n>one</n>", XSD));
  expect(bad.valid).toBe(false);
  expect(bad.schemaErrors.length).toBeGreaterThan(0);
  expect(bad.schemaErrors[0].line).toBe(1);
}

describe("browser entry", () => {
  let code: string;

  beforeAll(async () => {
    code = await bundleForBrowser("src/browser.ts");
  }, 60_000);

  it("bundles for the browser without any Node built-in", () => {
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/fs\/promises/);
  });

  it("the Node entry does not bundle for the browser, so the check above means something", async () => {
    await expect(bundleForBrowser("src/index.ts")).rejects.toThrow(/Could not resolve "fs\/promises"/);
  });

  it("has the API of the Node entry, apart from validateFiles", () => {
    const api = load(code, workerScope("https://host.test/app/worker.js", []));
    const nodeApi = Object.keys(require("../src/index")).filter((name) => name !== "validateFiles").sort();
    expect(Object.keys(api).sort()).toEqual(nodeApi);
    expect(api.validateFiles).toBeUndefined();
  });

  it("runs in a scope without process, Buffer or require", async () => {
    const scope = workerScope("https://host.test/app/worker.js", []);
    const api = load(code, scope);
    expect(scope.process).toBeUndefined();
    expect(scope.Buffer).toBeUndefined();
    expect(scope.require).toBeUndefined();
    await expectValidatorWorks(api);
  });

  it("in a web worker, fetches the WebAssembly file from next to the worker script", async () => {
    const fetched: string[] = [];
    const api = load(code, workerScope("https://host.test/extension/dist/web/server.js", fetched));
    await expectValidatorWorks(api);
    expect(fetched).toEqual(["https://host.test/extension/dist/web/xerces_validator.wasm"]);
  });

  it("in a page, fetches the WebAssembly file from next to the script", async () => {
    const fetched: string[] = [];
    const api = load(code, windowScope("https://page.test/js/app.js", fetched));
    await expectValidatorWorks(api);
    expect(fetched).toEqual(["https://page.test/js/xerces_validator.wasm"]);
  });

  it("fetches the file once, however many validations run", async () => {
    const fetched: string[] = [];
    const api = load(code, workerScope("https://host.test/w.js", fetched));
    await Promise.all([api.validate("<n>1</n>", XSD), api.validate("<n>2</n>", XSD), api.getModule()]);
    await expectValidatorWorks(api);
    expect(fetched).toHaveLength(1);
  });

  it("initialize({ locateFile }) chooses the URL of the WebAssembly file", async () => {
    const fetched: string[] = [];
    const api = load(code, workerScope("https://host.test/w.js", fetched));
    const asked: string[][] = [];
    await api.initialize({
      locateFile: (file: string, scriptDirectory: string) => {
        asked.push([file, scriptDirectory]);
        return `https://cdn.test/assets/${file}`;
      },
    });
    await expectValidatorWorks(api);
    expect(asked).toEqual([["xerces_validator.wasm", "https://host.test/"]]);
    expect(fetched).toEqual(["https://cdn.test/assets/xerces_validator.wasm"]);
  });

  it("initialize({ wasmBinary }) uses the given bytes and fetches nothing", async () => {
    const fetched: string[] = [];
    const api = load(code, workerScope("https://host.test/w.js", fetched));
    await api.initialize({ wasmBinary: new Uint8Array(WASM) });
    await expectValidatorWorks(api);
    expect(fetched).toEqual([]);
  });

  it("initialize({ wasmBinary }) works where there is no fetch and no script location", async () => {
    const scope = browserGlobals([]);
    delete scope.fetch;
    const api = load(code, scope);
    await api.initialize({ wasmBinary: new Uint8Array(WASM) });
    await expectValidatorWorks(api);
  });

  it("rejects when the WebAssembly file cannot be fetched, and loads on a later try", async () => {
    const fetched: string[] = [];
    let online = false;
    const scope = workerScope("https://host.test/w.js", fetched, async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response(WASM, { headers: { "content-type": "application/wasm" } });
    });
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const quietWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const api = load(code, scope);
      await expect(api.validate("<n>1</n>", XSD)).rejects.toBeDefined();
      // The loader may try the download more than once before it gives up.
      const failedAttempts = fetched.length;
      expect(failedAttempts).toBeGreaterThan(0);

      online = true;
      await expectValidatorWorks(api);
      expect(fetched).toHaveLength(failedAttempts + 1);
    } finally {
      quiet.mockRestore();
      quietWarn.mockRestore();
    }
  });

  it("validates Blob input and schema bundles", async () => {
    const api = load(code, workerScope("https://host.test/w.js", []));
    expect((await api.validate(new Blob(["<n>1</n>"]), new Blob([XSD]))).valid).toBe(true);
    const bundle = { entry: ENTRY, imports: { "types.xsd": new Blob([TYPES]) } };
    expect((await api.validate("<order><quantity>2</quantity></order>", bundle)).valid).toBe(true);
    expect((await api.validate("<order><quantity>-2</quantity></order>", bundle)).valid).toBe(false);
  });

  it("runs a project validator: compile once, validate, reload, destroy", async () => {
    const api = load(code, workerScope("https://host.test/w.js", []));
    const validator = await api.createProjectValidator({ entry: "entry.xsd", files: { "entry.xsd": ENTRY, "types.xsd": TYPES } });
    expect((await validator.validate("<order><quantity>2</quantity></order>")).valid).toBe(true);
    expect((await validator.validate("<order><quantity>0</quantity></order>")).valid).toBe(false);

    await validator.reload({ "entry.xsd": ENTRY, "types.xsd": TYPES.replace("xs:positiveInteger", "xs:integer") });
    expect((await validator.validate("<order><quantity>0</quantity></order>")).valid).toBe(true);

    validator.destroy();
    await expect(validator.validate("<order/>")).rejects.toThrow("already destroyed");
  });
});

describe("package.json browser field", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  it("swaps the Node entry for the browser entry", () => {
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.browser["./dist/index.js"]).toBe("./dist/browser.js");
  });

  it("leaves out the Node built-ins the WebAssembly glue only needs on Node", () => {
    const glue = fs.readFileSync(path.join(ROOT, "wasm", "xerces_validator.js"), "utf8");
    const required = [...glue.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    const ignored = Object.keys(pkg.browser).filter((key) => pkg.browser[key] === false).sort();
    expect(ignored).toEqual(required);
  });
});
