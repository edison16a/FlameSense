import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadData } from "./helpers/leaflet-stub.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the data validator passes against the committed data files", () => {
  // The validator is the single source for every structural rule: colour
  // handoff between phases, chainable phases, resolvable scroll targets,
  // readout keys that are actually requested, and the rest. Those rules used to
  // be written out a second time in this file, which meant two places to update
  // and no guarantee they agreed. Running the real thing keeps one copy.
  //
  // It also performs the fidelity comparison against the pre-refactor
  // index.html read out of git history, which is the check that the extraction
  // did not quietly lose or reword any content.
  const output = execFileSync("node", ["tools/validate-data.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.match(output, /All \d+ data checks passed/);
});

test("the content file covers every step the page renders", async () => {
  const content = await loadData("content.json");
  assert.equal(content.steps.length, 5);
  assert.deepEqual(content.steps.map((s) => s.id), ["how", "how2", "how3", "how4", "how5"]);
});

test("every nav control declares an action the navigation module understands", async () => {
  const content = await loadData("content.json");
  const controls = [content.nav.logo, ...content.nav.items, content.hero];
  for (const control of controls) {
    assert.ok(["home", "map"].includes(control.action), `${control.id ?? control.ctaId}: ${control.action}`);
  }
  // Exactly one nav item and the hero CTA open the map view.
  assert.equal(controls.filter((c) => c.action === "map").length, 2);
});

test("the city list survived extraction with all ten records intact", async () => {
  const { cities } = await loadData("cities.json");
  assert.equal(cities.length, 10);
  const losAngeles = cities.find((c) => c.name === "Los Angeles, CA");
  assert.deepEqual(losAngeles.coords, [34.0522, -118.2437]);
  assert.equal(losAngeles.risk, "Moderate");
  for (const city of cities) {
    assert.ok(city.coords[0] > 32 && city.coords[0] < 42, `${city.name} is outside California`);
    assert.ok(city.coords[1] > -125 && city.coords[1] < -114, `${city.name} is outside California`);
  }
});

test("the extractor reproduces the committed data files exactly", () => {
  // Re-runs extraction into a scratch directory and diffs. If this fails,
  // either the data files were hand-edited away from the original page, or the
  // extractor drifted. Both are worth knowing about.
  const outDir = resolve(REPO_ROOT, "node_modules/.extract-check");
  execFileSync("node", ["tools/extract-data.mjs", "--out", outDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  for (const name of ["content.json", "cities.json"]) {
    const regenerated = execFileSync("cat", [resolve(outDir, name)], { encoding: "utf8" });
    const committed = execFileSync("cat", [resolve(REPO_ROOT, "public/data", name)], { encoding: "utf8" });
    assert.equal(regenerated, committed, `${name} differs from a fresh extraction`);
  }
});
