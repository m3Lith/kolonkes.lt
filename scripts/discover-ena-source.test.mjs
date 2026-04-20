import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = `${process.cwd()}/scripts/discover-ena-source.mjs`;
const execFileAsync = promisify(execFile);

async function startHtmlServer(html) {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function runScript(args) {
  return execFileAsync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
  });
}

const closers = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      await close();
    }
  }
});

describe("discover-ena-source script", () => {
  it("prefers date from title and selects latest", async () => {
    const server = await startHtmlServer(`
      <html><body>
        <a href="https://example.sharepoint.com/a"
           title="Degalų kainos 2026-04-20">
          Naujausios degalų kainos (2020-01-01)
        </a>
        <a href="https://example.sharepoint.com/b">
          Naujausios degalų kainos (2026-04-19)
        </a>
      </body></html>
    `);
    closers.push(server.close);

    const result = await runScript(["--page-url", server.url, "--format", "json"]);
    const parsed = JSON.parse(result.stdout);

    expect(parsed.date).toBe("2026-04-20");
    expect(parsed.href).toBe("https://example.sharepoint.com/a");
  });

  it("falls back to date from anchor text when title is missing", async () => {
    const server = await startHtmlServer(`
      <html><body>
        <a href="https://example.sharepoint.com/c">
          Naujausios degalų kainos (2026-04-18)
        </a>
      </body></html>
    `);
    closers.push(server.close);

    const result = await runScript(["--page-url", server.url, "--format", "json"]);
    const parsed = JSON.parse(result.stdout);

    expect(parsed.date).toBe("2026-04-18");
    expect(parsed.href).toBe("https://example.sharepoint.com/c");
  });

  it("supports selecting an exact date", async () => {
    const server = await startHtmlServer(`
      <html><body>
        <a href="https://example.sharepoint.com/d" title="Degalų kainos 2026-04-20">
          Naujausios degalų kainos (2026-04-20)
        </a>
        <a href="https://example.sharepoint.com/e" title="Degalų kainos 2026-04-19">
          Naujausios degalų kainos (2026-04-19)
        </a>
      </body></html>
    `);
    closers.push(server.close);

    const result = await runScript([
      "--page-url",
      server.url,
      "--date",
      "2026-04-19",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);

    expect(parsed.date).toBe("2026-04-19");
    expect(parsed.href).toBe("https://example.sharepoint.com/e");
  });
});
