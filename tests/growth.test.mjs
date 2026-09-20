import test from "node:test";
import assert from "node:assert/strict";
import { createGrowthModel } from "../public/src/core/growth.js";
import { loadData } from "./helpers/leaflet-stub.mjs";

const config = await loadData("growth-model.json");

/** A model whose jitter is pinned to exactly zero, so results are exact. */
const pinned = () => createGrowthModel(config, () => 0.5);

test("baseline conditions score the configured base", () => {
  // Reference temperature, reference humidity, no rain: every term cancels.
  const model = pinned();
  assert.equal(model.computePercentage({ temperature_2m: 20, relative_humidity_2m: 50, rain: 0 }), "50.0");
});

test("heat raises the score and rain suppresses it", () => {
  const model = pinned();
  const hot = parseFloat(model.computePercentage({ temperature_2m: 30, relative_humidity_2m: 50, rain: 0 }));
  const wet = parseFloat(model.computePercentage({ temperature_2m: 30, relative_humidity_2m: 50, rain: 1 }));
  assert.equal(hot, 62);   // 50 + 10 degrees * 1.2
  assert.equal(wet, 52);   // ...minus 1mm * 10
  assert.ok(wet < hot);
});

test("dry air raises the score and damp air lowers it", () => {
  const model = pinned();
  const dry = parseFloat(model.computePercentage({ temperature_2m: 20, relative_humidity_2m: 20, rain: 0 }));
  const damp = parseFloat(model.computePercentage({ temperature_2m: 20, relative_humidity_2m: 80, rain: 0 }));
  assert.equal(dry, 59);   // 50 + 30 points of dryness * 0.3
  assert.equal(damp, 41);
});

test("the score is clamped to 0..100 however extreme the inputs", () => {
  const model = pinned();
  assert.equal(model.computePercentage({ temperature_2m: 500, relative_humidity_2m: 0, rain: 0 }), "100.0");
  assert.equal(model.computePercentage({ temperature_2m: -100, relative_humidity_2m: 100, rain: 50 }), "0.0");
});

test("jitter stays within its configured band and never escapes the clamp", () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
    const model = createGrowthModel(config, () => r);
    const score = parseFloat(model.computePercentage({ temperature_2m: 20, relative_humidity_2m: 50, rain: 0 }));
    assert.ok(score >= 40 && score <= 60, `jitter produced ${score}, outside 40..60`);
    assert.ok(score >= 0 && score <= 100);
  }
});

test("a reading of zero is used, not treated as missing", () => {
  // REGRESSION: the original parsed inputs as `parseFloat(x) || default`, and
  // zero is falsy. A 0 C reading was scored as 20 C and 0% humidity -- the
  // driest, highest-risk case -- was scored as a middling 50%, which pushed the
  // score DOWN by 15 points in exactly the conditions where fire spreads worst.
  const model = pinned();
  const freezing = parseFloat(
    model.computePercentage({ temperature_2m: 0, relative_humidity_2m: 0, rain: 0 }),
  );
  // 50 - (20 * 1.2) + (50 * 0.3) = 50 - 24 + 15 = 41
  assert.equal(freezing, 41);
  assert.notEqual(freezing, 50, "a zero reading must not fall back to the defaults");
});

test("genuinely absent fields still fall back to the defaults", () => {
  const model = pinned();
  assert.equal(model.computePercentage({}), "50.0");
  assert.equal(model.computePercentage({ temperature_2m: null, relative_humidity_2m: undefined }), "50.0");
  assert.equal(model.computePercentage({ temperature_2m: "not a number" }), "50.0");
});

test("the older current_weather field name is still understood", () => {
  // Open-Meteo's legacy block calls the same quantity `temperature`.
  const model = pinned();
  assert.equal(model.computePercentage({ temperature: 30 }), "62.0");
});

test("temperature_2m wins when both field names are present", () => {
  const model = pinned();
  assert.equal(model.computePercentage({ temperature_2m: 30, temperature: 0 }), "62.0");
});

test("the score is formatted to exactly one decimal place", () => {
  const model = createGrowthModel(config, () => 0.123456);
  assert.match(model.computePercentage({ temperature_2m: 23.456 }), /^\d+\.\d$/);
});

test("the growth factor is 1.0 before any weather has been fetched", () => {
  // Load-bearing: the very first fire is drawn on entering the map view,
  // before any request completes, and must not be silently rescaled.
  assert.equal(pinned().growthFactor(), 1);
  assert.equal(pinned().currentPercentage(), null);
});

test("the growth factor tracks the most recent score", () => {
  const model = pinned();
  model.computePercentage({ temperature_2m: 20, relative_humidity_2m: 50, rain: 0 }); // 50
  assert.equal(model.growthFactor(), 1);

  model.computePercentage({ temperature_2m: 30, relative_humidity_2m: 50, rain: 0 }); // 62
  assert.ok(Math.abs(model.growthFactor() - 1.12) < 1e-9);

  model.computePercentage({ temperature_2m: 500, relative_humidity_2m: 0, rain: 0 }); // 100
  assert.ok(Math.abs(model.growthFactor() - 1.5) < 1e-9);

  model.computePercentage({ temperature_2m: -100, relative_humidity_2m: 100, rain: 99 }); // 0
  assert.ok(Math.abs(model.growthFactor() - 0.5) < 1e-9);
});

test("the factor clamp is disabled, as the original left it", () => {
  // The original wrote the clamp and commented it out. It is preserved as an
  // explicit flag; this pins the shipped default so enabling it is a decision.
  assert.equal(config.factor.clamp.enabled, false);
  const clamped = createGrowthModel(
    { ...config, factor: { ...config.factor, clamp: { enabled: true, min: 0.9, max: 1.1 } } },
    () => 0.5,
  );
  clamped.computePercentage({ temperature_2m: 500 });
  assert.equal(clamped.growthFactor(), 1.1);
});

test("each model instance keeps its own state", () => {
  const a = pinned();
  const b = pinned();
  a.computePercentage({ temperature_2m: 500 });
  assert.equal(a.currentPercentage(), 100);
  assert.equal(b.currentPercentage(), null, "instances must not share state via a global");
});
