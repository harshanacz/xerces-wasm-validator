// Code written against 2.0.2 must keep working. These tests pin the parts of the
// module's shape that such code can depend on beyond the function signatures.
"use strict";

type Api = typeof import("../src/index");

function freshApi(): Api {
  let api!: Api;
  jest.isolateModules(() => {
    api = require("../src/index");
  });
  return api;
}

const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="n" type="xs:int"/></xs:schema>`;

// A stand-in for the WebAssembly module: every validation reports "FAKE".
const fakeModule = {
  validate: () => ({ valid: "FAKE", parseErrors: [], schemaErrors: [] }),
  ProjectValidator: function (this: any) {
    this.init = () => true;
    this.validate = () => ({ valid: "FAKE", parseErrors: [], schemaErrors: [] });
    this.delete = () => undefined;
  },
};

describe("compatibility with 2.0.2", () => {
  it("exports the 2.0.2 functions plus initialize", () => {
    const names = Object.keys(freshApi()).filter((k) => k !== "__esModule").sort();
    expect(names).toEqual(["createProjectValidator", "getModule", "initialize", "toText", "validate", "validateFiles"]);
  });

  it.each(["getModule", "initialize", "toText", "validate", "validateFiles"])(
    "%s is a plain writable property, so assigning a replacement works",
    (name) => {
      const api = freshApi() as any;
      const descriptor = Object.getOwnPropertyDescriptor(api, name)!;
      expect(descriptor.get).toBeUndefined();
      expect(descriptor.writable).toBe(true);
      expect(typeof descriptor.value).toBe("function");

      // This file is strict mode, where assigning to a getter-only property throws.
      const replacement = async () => "stub";
      api[name] = replacement;
      expect(api[name]).toBe(replacement);
    }
  );

  it("jest.spyOn works on every function", async () => {
    const api = freshApi();
    const spy = jest.spyOn(api, "validate").mockResolvedValue({ valid: true, parseErrors: [], schemaErrors: [] });
    expect((await api.validate("<x/>", XSD)).valid).toBe(true);
    expect(spy).toHaveBeenCalledWith("<x/>", XSD);
    for (const name of ["getModule", "initialize", "toText", "validateFiles", "createProjectValidator"] as const) {
      expect(() => jest.spyOn(api, name)).not.toThrow();
    }
  });

  it("createProjectValidator loads the module through the exported getModule, as in 2.0.2", async () => {
    const api = freshApi() as any;
    api.getModule = async () => fakeModule;
    const validator = await api.createProjectValidator({ entry: "n.xsd", files: { "n.xsd": XSD } });
    expect((await validator.validate("<n>1</n>")).valid).toBe("FAKE");
  });

  it("createProjectValidator follows a jest.spyOn of getModule", async () => {
    const api = freshApi();
    jest.spyOn(api, "getModule").mockResolvedValue(fakeModule);
    const validator = await api.createProjectValidator({ entry: "n.xsd", files: { "n.xsd": XSD } });
    expect((await validator.validate("<n>1</n>")).valid).toBe("FAKE");
  });

  it("validate does not go through the exported getModule, as in 2.0.2", async () => {
    const api = freshApi() as any;
    api.getModule = async () => fakeModule;
    expect((await api.validate("<n>1</n>", XSD)).valid).toBe(true);
  });

  it("createProjectValidator uses the real module again once getModule is restored", async () => {
    const api = freshApi() as any;
    const real = api.getModule;
    api.getModule = async () => fakeModule;
    api.getModule = real;
    const validator = await api.createProjectValidator({ entry: "n.xsd", files: { "n.xsd": XSD } });
    try {
      expect((await validator.validate("<n>1</n>")).valid).toBe(true);
      expect((await validator.validate("<n>x</n>")).valid).toBe(false);
    } finally {
      validator.destroy();
    }
  });
});
