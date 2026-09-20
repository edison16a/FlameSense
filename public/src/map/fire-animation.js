/**
 * The fire-spread animation runner.
 *
 * WHY this replaces eight functions: the original had animatePhase1..4 for map
 * clicks and animateExistingPhase1..4 for real events. They were ~40 lines
 * each, textually almost identical, and each hard-coded its own colours,
 * duration, scale and successor by name. Changing the ramp meant eight edits,
 * and the genuine differences between the two sequences were invisible amid the
 * repetition.
 *
 * Here there is one runner driven by the tables in `data/fire-phases.json`.
 * Both sequences are reproduced exactly, including the shape discontinuity in
 * the `existing` sequence (see `startFrom` below), which is shipped behaviour.
 */

import { interpolateColor } from "../core/color.js";
import {
  createPolygonVertices,
  interpolateVertices,
  randomInRange,
  randomOffsets,
} from "../core/geometry.js";

/** @typedef {import("../core/geometry.js").LatLng} LatLng */
/** @typedef {Array<[number, number]>} VertexRing */

/**
 * Create an animator bound to a map and a phase table.
 *
 * Leaflet, the clock and the randomness are all injected rather than reached
 * for globally, so the runner can be driven by a fake map and a stub scheduler
 * in tests.
 *
 * @param {object} deps
 * @param {object} deps.L The Leaflet namespace.
 * @param {object} deps.map The Leaflet map instance to draw on.
 * @param {object} deps.phases Parsed `data/fire-phases.json`.
 * @param {() => number} deps.windDirection Current wind bearing in degrees;
 *   read per frame so a fire started before the weather arrives still bends
 *   once it does.
 * @param {import("./polygon-store.js").PolygonStore} deps.store
 * @param {(cb: (t: number) => void) => void} [deps.requestFrame]
 * @param {(cb: () => void, ms: number) => void} [deps.schedule]
 * @param {() => number} [deps.random]
 */
export function createFireAnimator({
  L,
  map,
  phases,
  windDirection,
  store,
  requestFrame = (cb) => requestAnimationFrame(cb),
  schedule = (cb, ms) => setTimeout(cb, ms),
  random = Math.random,
}) {
  const geometry = phases.geometry;

  /** Build one frame's vertex ring for the given shape parameters. */
  const vertices = (center, baseRadius, offsets, scale, angleOffset) =>
    createPolygonVertices(
      center,
      baseRadius,
      offsets,
      scale,
      angleOffset,
      windDirection(),
      geometry,
    );

  /** Leaflet style object; stroke and fill always share the phase colour. */
  const styleFor = (color) => ({
    color,
    fillColor: color,
    fillOpacity: phases.polygonStyle.fillOpacity,
  });

  /**
   * Drive a callback from 0 to 1 over `duration` milliseconds.
   *
   * Progress is derived from the timestamp difference rather than counting
   * frames, so the animation takes the same wall-clock time regardless of
   * refresh rate or dropped frames.
   *
   * @param {number} duration
   * @param {(t: number) => void} onFrame
   * @param {() => void} onDone
   */
  function tween(duration, onFrame, onDone) {
    let startTime = null;
    function step(timestamp) {
      if (startTime === null) startTime = timestamp;
      const t = Math.min((timestamp - startTime) / duration, 1);
      onFrame(t);
      if (t < 1) requestFrame(step);
      else onDone();
    }
    requestFrame(step);
  }

  /**
   * Run one phase and chain into the next.
   *
   * @param {object} sequence The sequence table being run.
   * @param {number} index Phase position within that table.
   * @param {LatLng} center
   * @param {number} baseRadius Metres; constant for the whole sequence.
   * @param {number[]} offsets Current per-vertex ragged extension.
   * @param {number} angleOffset Current ring rotation, radians.
   * @param {VertexRing | null} previousVertices Closing ring of the prior phase.
   */
  function runPhase(sequence, index, center, baseRadius, offsets, angleOffset, previousVertices) {
    const phase = sequence.phases[index];

    /*
     * Where this phase opens.
     *
     * `previous` continues from exactly where the last phase closed, giving the
     * seamless morph of the click-driven sequence. `recomputed` rebuilds the
     * ring from the current offsets at this phase's *new* rotation, so the
     * shape visibly snaps at the boundary. That snap is how the original
     * behaved for EONET fires and is preserved intentionally.
     */
    const startVertices =
      phase.startFrom === "previous" && previousVertices
        ? previousVertices
        : vertices(center, baseRadius, offsets, phase.startScale ?? 1, angleOffset);

    const polygon = L.polygon(startVertices, styleFor(phase.strokeColor)).addTo(map);
    store.add(polygon);

    /** Paint one frame's colour, shared by both phase kinds. */
    const paint = (t) => {
      const color = interpolateColor(phase.startColor, phase.endColor, t);
      polygon.setStyle({ color, fillColor: color });
    };

    /** Chain onward, or finish the sequence. */
    const advance = (closingVertices, nextOffsets) => {
      const isLast = index === sequence.phases.length - 1;
      if (isLast) {
        schedule(() => store.bringSmallestToFront(), phases.reorderDelayMs);
        return;
      }
      const nextAngle = randomInRange(phase.nextAngleOffset, random);
      runPhase(sequence, index + 1, center, baseRadius, nextOffsets, nextAngle, closingVertices);
    };

    if (phase.kind === "scale") {
      /*
       * Scale phases re-derive the ring every frame from a growing scale rather
       * than interpolating between two fixed rings. The offsets themselves do
       * not change, so the blob inflates without its outline re-randomising.
       */
      tween(
        phase.durationMs,
        (t) => {
          const scale = phase.startScale + (phase.endScale - phase.startScale) * t;
          polygon.setLatLngs(vertices(center, baseRadius, offsets, scale, angleOffset));
          paint(t);
        },
        () => advance(vertices(center, baseRadius, offsets, phase.endScale, angleOffset), offsets),
      );
      return;
    }

    // Morph phases grow every vertex by an independent random amount, which is
    // what keeps the perimeter ragged instead of expanding as a smooth ring.
    const grownOffsets = offsets.map((offset) => offset + randomInRange(phase.offsetGrowth, random));
    const targetVertices = vertices(center, baseRadius, grownOffsets, phase.targetScale, angleOffset);

    tween(
      phase.durationMs,
      (t) => {
        polygon.setLatLngs(interpolateVertices(startVertices, targetVertices, t));
        paint(t);
      },
      () => advance(targetVertices, grownOffsets),
    );
  }

  /**
   * Start a named sequence at a point.
   *
   * @param {"clicked" | "existing"} sequenceName Key into the phase tables.
   * @param {LatLng} center
   * @param {number} baseRadius Metres, already scaled by the growth factor.
   */
  function run(sequenceName, center, baseRadius) {
    const sequence = phases.sequences[sequenceName];
    const offsets = randomOffsets(sequence.numSides, sequence.initialOffset, random);
    const angleOffset = randomInRange(sequence.initialAngleOffset, random);
    runPhase(sequence, 0, center, baseRadius, offsets, angleOffset, null);
  }

  return { run };
}
