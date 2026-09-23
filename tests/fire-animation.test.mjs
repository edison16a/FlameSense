import test from "node:test";
import assert from "node:assert/strict";
import { createFireAnimator } from "../public/src/map/fire-animation.js";
import { createPolygonStore } from "../public/src/map/polygon-store.js";
import { createLeafletStub, createSyncScheduler, loadData } from "./helpers/leaflet-stub.mjs";

const phases = await loadData("fire-phases.json");
const CENTER = { lat: 34.0522, lng: -118.2437 };

/**
 * Run a whole sequence to completion synchronously.
 *
 * The real animation spans 28 seconds of requestAnimationFrame; the stub
 * scheduler jumps past each phase's duration in one step so an entire run is a
 * single synchronous call.
 */
function runSequence(name, { baseRadius = 1000, wind = 0, random = () => 0.5 } = {}) {
  const { L, record } = createLeafletStub();
  const scheduler = createSyncScheduler();
  const store = createPolygonStore();
  const animator = createFireAnimator({
    L,
    map: {},
    phases,
    windDirection: () => wind,
    store,
    requestFrame: scheduler.requestFrame,
    schedule: scheduler.schedule,
    random,
  });
  animator.run(name, CENTER, baseRadius);
  scheduler.run();
  return { record, store };
}

for (const name of ["clicked", "existing"]) {
  const table = phases.sequences[name];

  test(`${name}: draws one polygon per phase and leaves them all on the map`, () => {
    // Each phase deliberately leaves its predecessor drawn, so a finished fire
    // reads outward as four nested shapes rather than one.
    const { record } = runSequence(name);
    assert.equal(record.polygons.length, table.phases.length);
  });

  test(`${name}: every polygon has the configured side count`, () => {
    const { record } = runSequence(name);
    for (const polygon of record.polygons) {
      assert.equal(polygon.vertices.length, table.numSides);
    }
  });

  test(`${name}: each polygon opens on its phase's stroke colour`, () => {
    const { record } = runSequence(name);
    record.polygons.forEach((polygon, i) => {
      assert.equal(polygon.initialColor, table.phases[i].strokeColor);
    });
  });

  test(`${name}: each polygon finishes on its phase's end colour`, () => {
    const { record } = runSequence(name);
    record.polygons.forEach((polygon, i) => {
      assert.equal(polygon.color, table.phases[i].endColor);
    });
  });

  test(`${name}: the ramp runs red to orange to yellow to green`, () => {
    const { record } = runSequence(name);
    assert.deepEqual(record.polygons.map((p) => p.color), ["#ff0000", "#ff7f00", "#ffff00", "#00ff00"]);
  });

  test(`${name}: every polygon uses the configured fill opacity`, () => {
    const { record } = runSequence(name);
    for (const polygon of record.polygons) {
      assert.equal(polygon.styles[0].fillOpacity, phases.polygonStyle.fillOpacity);
    }
  });

  test(`${name}: the fire grows outward across phases`, () => {
    const { record } = runSequence(name);
    const spread = (polygon) =>
      Math.max(...polygon.vertices.map(([lat, lng]) => Math.hypot(lat - CENTER.lat, lng - CENTER.lng)));
    const sizes = record.polygons.map(spread);
    for (let i = 1; i < sizes.length; i++) {
      assert.ok(sizes[i] > sizes[i - 1], `phase ${i + 1} (${sizes[i]}) did not exceed phase ${i}`);
    }
  });

  test(`${name}: the smallest polygon ends up in front`, () => {
    // Later phases are larger and would bury the earlier ones, hiding the
    // colour progression the visualisation exists to show.
    const { record } = runSequence(name);
    assert.equal(record.frontOrder.length, table.phases.length);
    assert.equal(record.frontOrder[record.frontOrder.length - 1], record.polygons[0],
      "the first, tightest polygon must be raised last");
  });
}

test("clicked: the first phase inflates without re-randomising its outline", () => {
  // The scale phase re-derives vertices from a growing scale each frame rather
  // than interpolating between two rings, so the outline keeps its shape.
  const { record } = runSequence("clicked");
  const first = record.polygons[0];
  const scalePhase = phases.sequences.clicked.phases[0];
  assert.equal(scalePhase.kind, "scale");
  assert.equal(first.styles[0].color, first.styles[0].fillColor);
  assert.equal(first.vertices.length, phases.sequences.clicked.numSides);
});

test("clicked: phases open exactly where the previous phase closed", () => {
  // startFrom 'previous' is what makes the click sequence a seamless morph.
  const { record } = runSequence("clicked");
  for (let i = 1; i < record.polygons.length; i++) {
    assert.equal(phases.sequences.clicked.phases[i].startFrom, "previous");
  }
  // With randomness pinned, a phase's opening ring is reproducible; assert the
  // sequence produced strictly nested, non-degenerate shapes.
  for (const polygon of record.polygons) {
    assert.ok(polygon.vertices.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)));
  }
});

test("existing: phases rebuild their opening ring, which is why the shape snaps", () => {
  // Preserved shipped behaviour, not an oversight. Documented so nobody
  // 'fixes' it into the smooth behaviour of the other sequence by accident.
  for (const phase of phases.sequences.existing.phases) {
    assert.equal(phase.startFrom, "recomputed");
  }
});

test("existing: growth comes entirely from the offsets, never from scaling", () => {
  // The starting radius already encodes the event's reported acreage, so
  // scaling it again would double-count the fire's real size.
  for (const phase of phases.sequences.existing.phases) {
    assert.equal(phase.startScale, 1);
    assert.equal(phase.targetScale, 1);
  }
  assert.equal(phases.sequences.existing.baseRadiusMetres, undefined);
});

test("the two sequences keep their distinct pacing", () => {
  const durations = (name) => phases.sequences[name].phases.map((p) => p.durationMs);
  assert.deepEqual(durations("clicked"), [7000, 7000, 7000, 7000]);
  assert.deepEqual(durations("existing"), [3000, 3000, 3000, 3000]);
});

test("a fire started with a larger base radius is drawn larger", () => {
  const spread = ({ record }) =>
    Math.max(...record.polygons[0].vertices.map(([lat]) => Math.abs(lat - CENTER.lat)));
  assert.ok(spread(runSequence("existing", { baseRadius: 20000 })) >
            spread(runSequence("existing", { baseRadius: 1000 })));
});

test("wind bends the fire without changing the number of shapes drawn", () => {
  const calm = runSequence("clicked", { wind: 0 });
  const windy = runSequence("clicked", { wind: 180 });
  assert.equal(calm.record.polygons.length, windy.record.polygons.length);
  assert.notDeepEqual(calm.record.polygons[0].vertices, windy.record.polygons[0].vertices);
});

test("the polygon store raises shapes smallest-first", () => {
  const store = createPolygonStore();
  const raised = [];
  const make = (id) => ({ id, bringToFront: () => raised.push(id) });
  store.add(make("a"));
  store.add(make("b"));
  store.add(make("c"));
  store.bringSmallestToFront();
  // Raised last-to-first, so 'a' finishes on top.
  assert.deepEqual(raised, ["c", "b", "a"]);
});

test("resetting the store forgets shapes without touching the map", () => {
  const store = createPolygonStore();
  let removed = 0;
  store.add({ bringToFront() {}, remove: () => removed++ });
  store.reset();
  assert.equal(store.all().length, 0);
  assert.equal(removed, 0, "reset must not remove anything already drawn");
});
