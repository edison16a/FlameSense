import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadData } from "./helpers/leaflet-stub.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the data validator passes against the committed data files", () => {
  // Runs the real validator, including its fidelity comparison against the
  // pre-refactor index.html read out of git history. This is the check that
  // the extraction did not quietly lose or reword any content.
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

test("scroll targets name elements that will exist in the DOM", async () => {
  const content = await loadData("content.json");
  const ids = new Set([...content.steps.map((s) => s.id), "hero"]);
  for (const control of [content.nav.logo, ...content.nav.items]) {
    if (control.action !== "home") continue;
    assert.ok(ids.has(control.scrollTarget), `${control.id} scrolls to missing #${control.scrollTarget}`);
  }
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

test("phase tables hand colour off cleanly between consecutive phases", async () => {
  // A mismatch here shows as a visible seam: the new polygon would appear in
  // one colour and immediately jump to another on its first frame.
  const phases = await loadData("fire-phases.json");
  for (const [name, sequence] of Object.entries(phases.sequences)) {
    for (let i = 0; i < sequence.phases.length; i++) {
      const phase = sequence.phases[i];
      assert.equal(phase.strokeColor, phase.startColor, `${name}[${i}] opens on the wrong colour`);
      if (i > 0) {
        assert.equal(phase.startColor, sequence.phases[i - 1].endColor, `${name}[${i}] breaks the ramp`);
      }
    }
  }
});

test("only the final phase of each sequence ends the chain", async () => {
  const phases = await loadData("fire-phases.json");
  for (const [name, sequence] of Object.entries(phases.sequences)) {
    sequence.phases.forEach((phase, i) => {
      const isLast = i === sequence.phases.length - 1;
      assert.equal(phase.nextAngleOffset === undefined, isLast, `${name}[${i}]`);
    });
  }
});
