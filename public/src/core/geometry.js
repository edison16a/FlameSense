/**
 * Geometry for the fire blob: turning a centre, a radius and a set of per-vertex
 * offsets into latitude/longitude pairs, with the shape stretched downwind.
 *
 * Pure and framework-free on purpose. It takes plain numbers and returns plain
 * arrays, so the wind bias and the metre-to-degree projection can be tested
 * without Leaflet.
 */

/**
 * A geographic point.
 * @typedef {{ lat: number, lng: number }} LatLng
 */

/**
 * Tuning for the shape, supplied from `data/fire-phases.json`.
 * @typedef {object} GeometryConfig
 * @property {{ amplitude: number, minFactor: number, maxFactor: number }} windBias
 * @property {number} metresPerDegreeLatitude
 * @property {number} equatorialCircumferenceMetres
 */

/**
 * How much to stretch a vertex that points in `angle`, given the wind bearing.
 *
 * The factor peaks downwind and troughs upwind following a cosine, then is
 * clamped. WHY the clamp: without it an amplitude above 1 would drive the
 * factor negative on the upwind side and flip those vertices through the centre,
 * turning the polygon inside out. The clamp also stops the shape degenerating
 * into a thin crescent at high amplitudes.
 *
 * @param {number} angle Vertex bearing in radians.
 * @param {number} windDirectionRadians Wind bearing in radians.
 * @param {GeometryConfig["windBias"]} windBias
 * @returns {number} Multiplier applied to the vertex's radius.
 */
export function windFactorFor(angle, windDirectionRadians, windBias) {
  const raw = 1 + windBias.amplitude * Math.cos(angle - windDirectionRadians);
  if (raw < windBias.minFactor) return windBias.minFactor;
  if (raw > windBias.maxFactor) return windBias.maxFactor;
  return raw;
}

/**
 * Build the vertex ring for one frame of the animation.
 *
 * Note that `scale` multiplies only the per-vertex offsets, never `baseRadius`.
 * That is deliberate and matches the original: the base radius is the fire's
 * established size (1 km for a fresh click, or the reported burn radius for a
 * real event) and stays fixed, while the ragged offsets are what grow outward.
 *
 * The projection is a local flat-earth approximation. One degree of latitude is
 * a constant; one degree of longitude shrinks with cos(latitude). At the few
 * kilometres a single fire spans the error is far below the resolution anyone
 * can see on the map, and it avoids pulling in a geodesy dependency.
 *
 * @param {LatLng} center
 * @param {number} baseRadius Fixed radius in metres.
 * @param {number[]} offsets Per-vertex ragged extension in metres; its length
 *   determines the number of sides.
 * @param {number} scale Multiplier applied to `offsets`.
 * @param {number} angleOffset Rotation of the whole ring, in radians.
 * @param {number} windDirectionDegrees Wind bearing in degrees.
 * @param {GeometryConfig} geometry
 * @returns {Array<[number, number]>} `[lat, lng]` pairs, ready for Leaflet.
 */
export function createPolygonVertices(
  center,
  baseRadius,
  offsets,
  scale,
  angleOffset,
  windDirectionDegrees,
  geometry,
) {
  const numSides = offsets.length;
  const windDirectionRadians = (windDirectionDegrees * Math.PI) / 180;
  // Metres per degree of longitude at this latitude. Computed once outside the
  // loop because it depends only on the centre, not on the vertex.
  const metresPerDegreeLongitude =
    (geometry.equatorialCircumferenceMetres * Math.cos((center.lat * Math.PI) / 180)) / 360;

  const vertices = [];
  for (let i = 0; i < numSides; i++) {
    const rawRadius = baseRadius + offsets[i] * scale;
    const angle = ((2 * Math.PI) / numSides) * i + angleOffset;
    const finalRadius = rawRadius * windFactorFor(angle, windDirectionRadians, geometry.windBias);

    // Bearings are measured from north: cos drives latitude, sin longitude.
    const deltaLat = (finalRadius / geometry.metresPerDegreeLatitude) * Math.cos(angle);
    const deltaLng = (finalRadius / metresPerDegreeLongitude) * Math.sin(angle);

    vertices.push([center.lat + deltaLat, center.lng + deltaLng]);
  }
  return vertices;
}

/**
 * Linearly interpolate between two equally sized vertex rings.
 *
 * Pairs vertices by index rather than by position, which is why every phase must
 * keep the same side count: mismatched lengths would tear the polygon.
 *
 * @param {Array<[number, number]>} from
 * @param {Array<[number, number]>} to
 * @param {number} t Progress in [0, 1].
 * @returns {Array<[number, number]>}
 */
export function interpolateVertices(from, to, t) {
  return from.map((point, i) => [
    point[0] + (to[i][0] - point[0]) * t,
    point[1] + (to[i][1] - point[1]) * t,
  ]);
}

/**
 * Draw `count` offsets from the half-open range `[min, min + range)`.
 *
 * Every ragged edge in the animation is produced this way, so the pattern is
 * named once here instead of being re-derived at each call site. The `random`
 * parameter exists so tests can inject a deterministic source.
 *
 * @param {number} count
 * @param {{ min: number, range: number }} spec
 * @param {() => number} [random]
 * @returns {number[]}
 */
export function randomOffsets(count, spec, random = Math.random) {
  return Array.from({ length: count }, () => spec.min + random() * spec.range);
}

/**
 * Draw a single value from `[min, min + range)`.
 *
 * Used for the per-phase rotation jitter, which shrinks phase by phase so the
 * blob wobbles less as it settles.
 *
 * @param {{ min: number, range: number }} spec
 * @param {() => number} [random]
 * @returns {number}
 */
export function randomInRange(spec, random = Math.random) {
  return spec.min + random() * spec.range;
}
