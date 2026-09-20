/**
 * Hex colour arithmetic for the fire animation.
 *
 * Lives on its own because it is the one piece of the animation that is pure,
 * synchronous and trivially testable: given two colours and a progress value it
 * always returns the same colour. Keeping it out of the animation module means
 * the colour ramp can be verified without a DOM, a map or a clock.
 */

/**
 * An 8-bit RGB triple. Components are integers in [0, 255].
 * @typedef {{ r: number, g: number, b: number }} Rgb
 */

/**
 * Parse a `#rrggbb` string into its components.
 *
 * Only the six-digit form is supported, because that is the only form the phase
 * tables use. Three-digit shorthand would silently mis-parse here, so callers
 * must not introduce it without extending this function.
 *
 * @param {string} hex Colour such as `"#ff7f00"`; a missing `#` is tolerated.
 * @returns {Rgb}
 */
export function hexToRgb(hex) {
  const normalised = hex.replace("#", "");
  const bigint = parseInt(normalised, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

/**
 * Format components back into `#rrggbb`.
 *
 * Each component is zero-padded, which matters: without padding a channel value
 * below 16 produces a single digit and yields a five-character string that
 * browsers reject outright, turning a mid-animation frame invisible.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Linearly blend two hex colours.
 *
 * Interpolation is done in sRGB rather than a perceptual space. That is not the
 * most accurate choice, but it is what the original did and what the phase
 * colours were picked against, so it is preserved.
 *
 * @param {string} from Colour at `t = 0`.
 * @param {string} to Colour at `t = 1`.
 * @param {number} t Progress, expected in [0, 1]; values outside extrapolate.
 * @returns {string} The blended colour as `#rrggbb`.
 */
export function interpolateColor(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
  );
}
