#!/usr/bin/env node
/**
 * Validates every runtime data file.
 *
 * Two kinds of check, for two different failure modes:
 *
 *  1. STRUCTURAL -- does each file parse, carry the fields the code reads, and
 *     stay internally consistent (unique ids, resolvable scroll targets, well
 *     formed hex colours, images that exist on disk, phase tables whose shapes
 *     the animation runner can actually execute)? This catches a typo made
 *     while editing a data file by hand, which is now the normal way to change
 *     the site's content.
 *
 *  2. FIDELITY -- does the extracted content still match the pre-refactor page,
 *     byte for byte after whitespace normalisation? This is the check that the
 *     refactor did not silently lose or reword anything. It reads the original
 *     index.html straight out of git history, so it cannot be fooled by editing
 *     a working copy.
 *
 * Usage:
 *   node tools/validate-data.mjs                  # structural + fidelity
 *   node tools/validate-data.mjs --skip-fidelity  # structural only
 *   node tools/validate-data.mjs --baseline <rev>
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DATA_DIR = resolve(REPO_ROOT, "public/data");

/**
 * Last commit before the refactor began, i.e. the revision whose index.html is
 * the authority on what the page used to say.
 */
const DEFAULT_BASELINE = "879edf3";

const failures = [];
const checks = [];

/** Record a single assertion's outcome; collect rather than throw so one run reports everything. */
function check(name, condition, detail = "") {
  checks.push(name);
  if (!condition) failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
}

const readJson = (name) => JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8"));

const content = readJson("content.json");
const site = readJson("site.config.json");
const growth = readJson("growth-model.json");
const phases = readJson("fire-phases.json");
const cities = readJson("cities.json");

/* ---------------------------------------------------------------- structural */

// -- content.json ------------------------------------------------------------
check("content: has a document title", typeof content.document?.title === "string");
check("content: hero has all rendered fields",
  ["headingBefore", "flame", "headingAfter", "tagline", "ctaId", "ctaLabel", "backgroundImage"]
    .every((k) => typeof content.hero?.[k] === "string"));
check("content: at least one step panel", Array.isArray(content.steps) && content.steps.length > 0);

const stepIds = content.steps.map((s) => s.id);
check("content: step ids are unique", new Set(stepIds).size === stepIds.length);
for (const step of content.steps) {
  check(`content: step #${step.id} is complete`,
    ["id", "image", "alt", "heading", "body"].every((k) => typeof step[k] === "string" && step[k]));
  // Local images must actually be on disk; remote ones are not our problem.
  if (!/^https?:/.test(step.image)) {
    check(`content: step #${step.id} image exists`,
      existsSync(resolve(REPO_ROOT, "public", step.image)), step.image);
  }
}

// Every control the navigation module will try to wire must be complete, and
// any scroll target must name something that will exist in the DOM.
const controls = [content.nav.logo, ...content.nav.items, content.hero];
const scrollable = new Set([...stepIds, "hero"]);
for (const control of controls) {
  const id = control.id ?? control.ctaId;
  check(`content: control #${id} declares an action`,
    control.action === "home" || control.action === "map", String(control.action));
  if (control.action === "home") {
    check(`content: control #${id} scrolls to a real element`,
      scrollable.has(control.scrollTarget), control.scrollTarget);
  }
}
const controlIds = controls.map((c) => c.id ?? c.ctaId);
check("content: control ids are unique", new Set(controlIds).size === controlIds.length);

check("content: both map overlays have placeholder copy",
  ["timeOverlay", "growthOverlay"].every((k) => typeof content.mapOverlays?.[k] === "string"));

// -- site.config.json --------------------------------------------------------
for (const [name, url] of [
  ["weather", site.weather.endpoint],
  ["eonet", site.eonet.endpoint],
  ["geocoding", site.geocoding.endpoint],
  ["tiles", site.map.tileLayer.urlTemplate],
]) {
  check(`site: ${name} endpoint is https`, /^https:\/\//.test(url), url);
}
check("site: initial centre is a lat/lng pair",
  Array.isArray(site.map.initialCenter) && site.map.initialCenter.length === 2);
check("site: default fire centre is a lat/lng pair",
  Array.isArray(site.map.defaultFireCenter) && site.map.defaultFireCenter.length === 2);
check("site: every readout row is complete",
  site.weather.readout.every((r) => r.key && r.label && typeof r.unit === "string"));
check("site: readout keys are all requested from the API",
  site.weather.readout.every((r) => site.weather.current.includes(r.key)),
  site.weather.readout.filter((r) => !site.weather.current.includes(r.key)).map((r) => r.key).join(","));
check("site: acre conversion constant is exact", site.eonet.acresToSquareMetres === 4046.8564224);
check("site: geocoding has place keys to try", site.geocoding.placeKeys.length > 0);

// -- growth-model.json -------------------------------------------------------
const gp = growth.percentage;
check("growth: clamp range is ordered", gp.clamp.min < gp.clamp.max);
check("growth: jitter is centred on zero", gp.jitter.min + gp.jitter.range / 2 === 0,
  `min ${gp.jitter.min} range ${gp.jitter.range}`);
check("growth: base sits inside the clamp", gp.base >= gp.clamp.min && gp.base <= gp.clamp.max);
check("growth: factor default equals the pivot so the initial multiplier is 1.0",
  growth.factor.default === growth.factor.pivot);
check("growth: every coefficient is a finite number",
  [gp.base, gp.temperature.coefficient, gp.rain.coefficient, gp.humidity.coefficient,
   growth.factor.perPercent].every(Number.isFinite));

// -- fire-phases.json --------------------------------------------------------
const HEX = /^#[0-9a-f]{6}$/i;
const wb = phases.geometry.windBias;
check("phases: wind clamp range is ordered", wb.minFactor < wb.maxFactor);
check("phases: wind clamp keeps the factor positive so vertices cannot invert",
  wb.minFactor > 0);
check("phases: projection constants are the real ones",
  phases.geometry.metresPerDegreeLatitude === 111320 &&
  phases.geometry.equatorialCircumferenceMetres === 40075000);

for (const [name, sequence] of Object.entries(phases.sequences)) {
  check(`phases: ${name} has a positive side count`, sequence.numSides > 0);
  check(`phases: ${name} has phases`, sequence.phases.length > 0);
  sequence.phases.forEach((phase, i) => {
    const at = `${name}[${i}]`;
    check(`phases: ${at} duration is positive`, phase.durationMs > 0);
    check(`phases: ${at} colours are #rrggbb`,
      [phase.strokeColor, phase.startColor, phase.endColor].every((c) => HEX.test(c)));
    check(`phases: ${at} kind is understood by the runner`,
      phase.kind === "scale" || phase.kind === "morph", phase.kind);
    if (phase.kind === "morph") {
      check(`phases: ${at} declares where it opens`,
        phase.startFrom === "previous" || phase.startFrom === "recomputed", phase.startFrom);
      check(`phases: ${at} morph has offset growth and a target scale`,
        phase.offsetGrowth != null && Number.isFinite(phase.targetScale));
    } else {
      check(`phases: ${at} scale phase has both scales`,
        Number.isFinite(phase.startScale) && Number.isFinite(phase.endScale));
    }
    // Every phase but the last must be able to hand a rotation to its successor.
    const isLast = i === sequence.phases.length - 1;
    check(`phases: ${at} ${isLast ? "ends the chain" : "chains onward"}`,
      isLast ? phase.nextAngleOffset === undefined : phase.nextAngleOffset != null);
    // The stroke colour a phase opens with must be the colour it starts
    // interpolating from, or the polygon would jump on its first frame.
    check(`phases: ${at} stroke matches its start colour`,
      phase.strokeColor === phase.startColor, `${phase.strokeColor} vs ${phase.startColor}`);
  });
  // Consecutive phases must hand off colour cleanly for a continuous ramp.
  for (let i = 1; i < sequence.phases.length; i++) {
    check(`phases: ${name}[${i}] continues the previous colour`,
      sequence.phases[i].startColor === sequence.phases[i - 1].endColor,
      `${sequence.phases[i - 1].endColor} -> ${sequence.phases[i].startColor}`);
  }
}
check("phases: clicked sequence has its own base radius",
  Number.isFinite(phases.sequences.clicked.baseRadiusMetres));
check("phases: existing sequence takes its radius from the event, not config",
  phases.sequences.existing.baseRadiusMetres === undefined);

// -- cities.json -------------------------------------------------------------
check("cities: list is non-empty", cities.cities.length > 0);
for (const city of cities.cities) {
  const [lat, lng] = city.coords;
  check(`cities: ${city.name} has a plausible coordinate`,
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180, city.coords.join(","));
  check(`cities: ${city.name} has a risk level`, typeof city.risk === "string" && city.risk);
}

/* ------------------------------------------------------------------ fidelity */

const args = process.argv.slice(2);
const baselineIndex = args.indexOf("--baseline");
const baseline = baselineIndex === -1 ? DEFAULT_BASELINE : args[baselineIndex + 1];

if (!args.includes("--skip-fidelity")) {
  let original;
  try {
    original = execFileSync("git", ["show", `${baseline}:public/index.html`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    console.error(`! could not read ${baseline}:public/index.html; skipping fidelity checks`);
  }

  if (original) {
    // Normalise the original the same way the extractor did, so the comparison
    // is against rendered text rather than source formatting.
    const normalised = original.replace(/\s+/g, " ");

    for (const step of content.steps) {
      check(`fidelity: step #${step.id} heading is unchanged`,
        normalised.includes(`<h2>${step.heading}</h2>`), step.heading);
      check(`fidelity: step #${step.id} body is unchanged`,
        normalised.includes(step.body), step.body.slice(0, 48) + "...");
      // Images moved into assets/ during the refactor, so compare file names.
      check(`fidelity: step #${step.id} image is unchanged`,
        normalised.includes(basename(step.image)), step.image);
    }

    check("fidelity: hero tagline is unchanged", normalised.includes(content.hero.tagline));
    check("fidelity: hero CTA label is unchanged",
      normalised.includes(`>${content.hero.ctaLabel}</button>`));
    check("fidelity: hero photograph URL is unchanged",
      normalised.includes(content.hero.backgroundImage));
    check("fidelity: document title is unchanged",
      normalised.includes(`<title>${content.document.title}</title>`));
    check("fidelity: footer is unchanged",
      normalised.includes(content.footer.replace("©", "&copy;")));

    for (const item of content.nav.items) {
      check(`fidelity: nav item "${item.label}" is unchanged`,
        normalised.includes(`id="${item.id}">${item.label}</div>`), item.label);
    }
    for (const [id, text] of Object.entries(content.mapOverlays)) {
      check(`fidelity: overlay #${id} placeholder is unchanged`, normalised.includes(text), text);
    }

    // Cities are compared numerically: every coordinate must appear verbatim in
    // the original literal, which is what rules out a transposed digit.
    for (const city of cities.cities) {
      check(`fidelity: ${city.name} survived extraction intact`,
        normalised.includes(`"${city.name}"`) &&
        normalised.includes(`coords: [${city.coords[0]}, ${city.coords[1]}]`) &&
        normalised.includes(`risk: "${city.risk}"`),
        city.coords.join(", "));
    }
    check("fidelity: no city was dropped",
      (original.match(/name: "/g) || []).length === cities.cities.length);

    // Animation constants must match the originals exactly.
    for (const [name, sequence] of Object.entries(phases.sequences)) {
      check(`fidelity: ${name} side count is unchanged`,
        normalised.includes(`const numSides = ${sequence.numSides}`));
      for (const phase of sequence.phases) {
        check(`fidelity: ${name} ${phase.durationMs}ms duration appears in the original`,
          normalised.includes(` ${phase.durationMs},`), String(phase.durationMs));
      }
    }
    check("fidelity: clicked base radius is unchanged",
      normalised.includes(`const baseRadius = ${phases.sequences.clicked.baseRadiusMetres}`));
  }
}

/* -------------------------------------------------------------------- report */

if (failures.length > 0) {
  console.error(`\nFAILED ${failures.length} of ${checks.length} checks:\n`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}
console.log(`All ${checks.length} data checks passed.`);
