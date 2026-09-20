import test from "node:test";
import assert from "node:assert/strict";
import {
  createPolygonVertices,
  interpolateVertices,
  randomInRange,
  randomOffsets,
  windFactorFor,
} from "../public/src/core/geometry.js";
import { loadData, sequenceRandom } from "./helpers/leaflet-stub.mjs";

const phases = await loadData("fire-phases.json");
const GEO = phases.geometry;
const CENTER = { lat: 34.0522, lng: -118.2437 };
const flat = (n, value) => Array.from({ length: n }, () => value);

test("wind factor peaks downwind and troughs upwind", () => {
  const { windBias } = GEO;
  const downwind = windFactorFor(0, 0, windBias);
  const upwind = windFactorFor(Math.PI, 0, windBias);
  const crosswind = windFactorFor(Math.PI / 2, 0, windBias);
  assert.equal(downwind, 1 + windBias.amplitude);
  assert.equal(upwind, 1 - windBias.amplitude);
  assert.ok(Math.abs(crosswind - 1) < 1e-12, "crosswind should be unbiased");
  assert.ok(downwind > crosswind && crosswind > upwind);
});

test("wind factor never goes non-positive, so vertices cannot invert", () => {
  // With a large amplitude the raw cosine would drive the factor negative,
  // flipping upwind vertices through the centre and turning the polygon inside
  // out. The clamp is what prevents that; this pins it.
  const aggressive = { amplitude: 5, minFactor: 0.6, maxFactor: 1.4 };
  for (let angle = 0; angle < 2 * Math.PI; angle += 0.1) {
    const factor = windFactorFor(angle, 0, aggressive);
    assert.ok(factor >= aggressive.minFactor && factor <= aggressive.maxFactor);
    assert.ok(factor > 0);
  }
});

test("vertex count follows the offsets array", () => {
  for (const sides of [3, 12, 20]) {
    const vertices = createPolygonVertices(CENTER, 1000, flat(sides, 0), 1, 0, 0, GEO);
    assert.equal(vertices.length, sides);
  }
});

test("with no wind bias the ring is centred on the origin point", () => {
  const calm = { ...GEO, windBias: { amplitude: 0, minFactor: 0.6, maxFactor: 1.4 } };
  const vertices = createPolygonVertices(CENTER, 1000, flat(36, 0), 1, 0, 0, calm);
  const meanLat = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
  const meanLng = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
  assert.ok(Math.abs(meanLat - CENTER.lat) < 1e-9);
  assert.ok(Math.abs(meanLng - CENTER.lng) < 1e-9);
});

test("scale multiplies the offsets but never the base radius", () => {
  // This asymmetry is load-bearing: the base radius is the fire's established
  // size and must stay fixed while the ragged offsets are what grow outward.
  const calm = { ...GEO, windBias: { amplitude: 0, minFactor: 0.6, maxFactor: 1.4 } };
  const base = 1000;
  const offset = 500;
  const at = (scale) =>
    (createPolygonVertices(CENTER, base, [offset], scale, 0, 0, calm)[0][0] - CENTER.lat) *
    calm.metresPerDegreeLatitude;

  assert.ok(Math.abs(at(1) - (base + offset)) < 1e-6);
  assert.ok(Math.abs(at(2) - (base + offset * 2)) < 1e-6);
  // If scale multiplied the base too, this would be 2 * (base + offset) = 3000.
  assert.ok(Math.abs(at(2) - 3000) > 100);
});

test("angle offset rotates the whole ring without resizing it", () => {
  const calm = { ...GEO, windBias: { amplitude: 0, minFactor: 0.6, maxFactor: 1.4 } };
  const radius = (v) => Math.hypot(v[0] - CENTER.lat, v[1] - CENTER.lng);
  const plain = createPolygonVertices(CENTER, 1000, flat(8, 250), 1, 0, 0, calm);
  const turned = createPolygonVertices(CENTER, 1000, flat(8, 250), 1, Math.PI / 4, 0, calm);

  assert.notDeepEqual(plain[0], turned[0], "rotation should move the vertices");
  // A full turn of 2*pi/8 maps vertex i onto where vertex i+1 was.
  const stepped = createPolygonVertices(CENTER, 1000, flat(8, 250), 1, (2 * Math.PI) / 8, 0, calm);
  for (let i = 0; i < 7; i++) {
    assert.ok(Math.abs(radius(stepped[i]) - radius(plain[i + 1])) < 1e-12);
  }
});

test("longitude spacing narrows with latitude, matching the projection", () => {
  // One degree of longitude is shorter near the poles. A fire of identical
  // radius must therefore span more degrees of longitude further north.
  const calm = { ...GEO, windBias: { amplitude: 0, minFactor: 0.6, maxFactor: 1.4 } };
  const spanAt = (lat) => {
    const v = createPolygonVertices({ lat, lng: 0 }, 10000, flat(4, 0), 1, 0, 0, calm);
    return Math.abs(v[1][1] - v[3][1]);
  };
  assert.ok(spanAt(60) > spanAt(0), "high latitude should span more longitude");
  // Latitude spacing, by contrast, is constant.
  const latSpan = (lat) => {
    const v = createPolygonVertices({ lat, lng: 0 }, 10000, flat(4, 0), 1, 0, 0, calm);
    return Math.abs(v[0][0] - v[2][0]);
  };
  assert.ok(Math.abs(latSpan(60) - latSpan(0)) < 1e-9);
});

test("the blob stretches toward the wind bearing", () => {
  const bearingOf = (windDeg) => {
    const vertices = createPolygonVertices(CENTER, 1000, flat(72, 500), 1, 0, windDeg, GEO);
    let furthest = null;
    for (const [lat, lng] of vertices) {
      // Scale longitude into metres so the comparison is not distorted.
      const dy = (lat - CENTER.lat) * GEO.metresPerDegreeLatitude;
      const dx =
        ((lng - CENTER.lng) * GEO.equatorialCircumferenceMetres * Math.cos((CENTER.lat * Math.PI) / 180)) / 360;
      const d = Math.hypot(dx, dy);
      if (!furthest || d > furthest.d) furthest = { d, a: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
    }
    return furthest.a;
  };

  // Smallest signed angle between the two bearings, handling wrap-around at 360.
  const angularGap = (a, b) => Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);

  for (const bearing of [0, 90, 180, 270]) {
    const observed = bearingOf(bearing);
    assert.ok(
      angularGap(observed, bearing) < 5,
      `wind ${bearing} produced stretch toward ${observed}`,
    );
  }
});

test("interpolateVertices returns the endpoints exactly", () => {
  const from = [[0, 0], [1, 1]];
  const to = [[10, 10], [11, 11]];
  assert.deepEqual(interpolateVertices(from, to, 0), from);
  assert.deepEqual(interpolateVertices(from, to, 1), to);
  assert.deepEqual(interpolateVertices(from, to, 0.5), [[5, 5], [6, 6]]);
});

test("random helpers stay inside their configured range", () => {
  const spec = { min: 500, range: 1000 };
  const lows = randomOffsets(5, spec, sequenceRandom([0]));
  const highs = randomOffsets(5, spec, sequenceRandom([0.999999]));
  assert.deepEqual(lows, [500, 500, 500, 500, 500]);
  for (const value of highs) assert.ok(value > 1499 && value < 1500);
  assert.equal(randomOffsets(7, spec, Math.random).length, 7);
  assert.equal(randomInRange({ min: -0.2, range: 0.4 }, () => 0.5), 0);
});
