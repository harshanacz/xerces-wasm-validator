import * as http from "http";
import type { AddressInfo } from "net";
import { toText } from "../src/index";

describe("UrlInput — opt-in fetching of remote XML/XSD", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/schema.xsd") {
        res.writeHead(200, { "content-type": "text/xml" });
        res.end("<xs:schema/>");
      } else if (req.url === "/slow.xsd") {
        setTimeout(() => res.end("too-late"), 2000);
      } else if (req.url === "/missing.xsd") {
        res.writeHead(404);
        res.end("not found");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("fetches text from a { url } input", async () => {
    const text = await toText({ url: `${baseUrl}/schema.xsd` });
    expect(text).toBe("<xs:schema/>");
  });

  it("never fetches for a plain string — strings are always raw content", async () => {
    const text = await toText(`${baseUrl}/schema.xsd`);
    expect(text).toBe(`${baseUrl}/schema.xsd`);
  });

  it("throws a clear error on a non-OK HTTP response", async () => {
    await expect(toText({ url: `${baseUrl}/missing.xsd` })).rejects.toThrow(
      /HTTP 404/
    );
  });

  it("throws a clear error when the fetch exceeds timeoutMs", async () => {
    await expect(
      toText({ url: `${baseUrl}/slow.xsd`, timeoutMs: 100 })
    ).rejects.toThrow(/timed out after 100ms/);
  });
});
