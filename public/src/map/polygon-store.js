/**
 * The stack of polygons making up one fire.
 *
 * Each animation phase leaves its polygon on the map rather than replacing the
 * previous one, so a finished fire is four nested shapes reading outward from
 * red to green. This module owns that stack because the ordering rule at the
 * end is easy to get backwards and deserves to be stated once.
 */

/**
 * @typedef {object} PolygonStore
 * @property {(polygon: object) => void} add
 * @property {() => void} reset
 * @property {() => void} bringSmallestToFront
 * @property {() => object[]} all
 */

/**
 * Create an empty stack.
 *
 * @returns {PolygonStore}
 */
export function createPolygonStore() {
  /** Ordered oldest (smallest) to newest (largest). @type {object[]} */
  let polygons = [];

  return {
    add(polygon) {
      polygons.push(polygon);
    },

    /**
     * Forget the current stack without removing anything from the map.
     *
     * The polygons deliberately stay drawn; only this module's handle on them
     * is dropped, so a subsequent re-order affects just the newest fire.
     */
    reset() {
      polygons = [];
    },

    /**
     * Re-stack so the earliest, tightest polygon ends up on top.
     *
     * Later phases are larger and would otherwise bury the earlier ones, hiding
     * the colour progression that is the whole point of the visualisation.
     * Iterating from the end forward works because each `bringToFront` moves
     * one polygon above everything already raised. The last one raised is
     * index 0, so it finishes frontmost.
     */
    bringSmallestToFront() {
      for (let i = polygons.length - 1; i >= 0; i--) {
        polygons[i].bringToFront();
      }
    },

    all() {
      return polygons;
    },
  };
}
