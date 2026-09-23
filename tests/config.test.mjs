import test from "node:test";
import assert from "node:assert/strict";
import { loadAppData } from "../public/src/core/config.js";

/**
 * Install a fetch stub for one test.
 *
 * The loader is the one module that has to touch fetch, so the only way to
 * cover it is to replace the global. Restored in a finally so a failing test
 * cannot leak the stub into the next one.
 */
async function withFetch(handler, fn) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path) => {
    calls.push(path);
    return handler(path);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

const ok = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });

test("every data file is requested and returned under its key", async () => {
  await withFetch(
    (path) => ok({ from: path }),
    async (calls) => {
      const data = await loadAppData();
      assert.deepEqual(Object.keys(data).sort(), ["content", "growth", "phases", "site"]);
      assert.equal(data.content.from, "data/content.json");
      assert.equal(data.site.from, "data/site.config.json");
      assert.equal(data.growth.from, "data/growth-model.json");
      assert.equal(data.phases.from, "data/fire-phases.json");
      assert.equal(calls.length, 4, "each file should be fetched exactly once");
    },
  );
});

test("paths are relative to the document, so the site works from a subpath", async () => {
  // A leading slash would break the Vercel preview deployments, which serve the
  // site from a nested path.
  await withFetch(
    (path) => ok({ path }),
    async (calls) => {
      await loadAppData();
      for (const path of calls) {
        assert.ok(!String(path).startsWith("/"), `${path} must not be absolute`);
      }
    },
  );
});

test("the files are loaded in parallel rather than one after another", async () => {
  // None of them depends on another and the map cannot render until all four
  // are present, so serialising would cost three round trips for nothing.
  let inFlight = 0;
  let peak = 0;
  await withFetch(
    async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return ok({});
    },
    async () => {
      await loadAppData();
      assert.equal(peak, 4, `expected 4 concurrent requests, saw ${peak}`);
    },
  );
});

test("a missing data file fails loudly and names the file", async () => {
  // With no content there is no page, so this is a deployment error rather
  // than a runtime condition worth degrading through.
  await withFetch(
    () => ({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) }),
    async () => {
      await assert.rejects(() => loadAppData(), /data\/.*\.json.*404 Not Found/);
    },
  );
});

test("malformed JSON propagates rather than yielding a half-loaded app", async () => {
  await withFetch(
    () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("Unexpected token }");
      },
    }),
    async () => {
      await assert.rejects(() => loadAppData(), SyntaxError);
    },
  );
});

test("one bad file fails the whole load, even when the others are fine", async () => {
  await withFetch(
    (path) =>
      String(path).includes("fire-phases")
        ? { ok: false, status: 500, statusText: "Server Error", json: async () => ({}) }
        : ok({}),
    async () => {
      await assert.rejects(() => loadAppData(), /fire-phases\.json/);
    },
  );
});
