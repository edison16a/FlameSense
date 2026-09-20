/**
 * The "growth percentage" heuristic and the radius multiplier derived from it.
 *
 * This is the project's model surface: a crude stand-in on the front end for
 * the trained model described in the write-up. It is isolated here so the
 * coefficients can be retuned from `data/growth-model.json` and the behaviour
 * pinned by tests, rather than living inside a map event handler.
 */

/**
 * Coefficient block from `data/growth-model.json`.
 * @typedef {object} GrowthModelConfig
 * @property {object} percentage
 * @property {object} factor
 */

/**
 * A reading from the weather API. Field names differ between Open-Meteo's
 * `current` block and its older `current_weather` block, which is why the model
 * checks more than one key for temperature.
 * @typedef {Record<string, unknown>} WeatherReading
 */

/**
 * Build a growth model bound to a set of coefficients.
 *
 * Returned as a closure over config rather than a set of free functions because
 * the percentage and the factor share one piece of state: the most recent
 * percentage. The original held that in `window.currentGrowthPercentage`, a
 * mutable global any script on the page could clobber; keeping it private here
 * is behaviour-preserving because nothing outside the animation ever read it.
 *
 * @param {GrowthModelConfig} config
 * @param {() => number} [random] Injectable randomness for deterministic tests.
 * @returns {{
 *   computePercentage: (weather: WeatherReading) => string,
 *   currentPercentage: () => number | null,
 *   growthFactor: () => number,
 * }}
 */
export function createGrowthModel(config, random = Math.random) {
  const p = config.percentage;
  const f = config.factor;

  /**
   * Most recent computed percentage, or null before any weather has arrived.
   * Kept as null rather than defaulting to the pivot so `growthFactor` can tell
   * "no reading yet" from "a reading that happened to equal the pivot".
   * @type {number | null}
   */
  let latestPercentage = null;

  /**
   * Score current conditions from 0 to 100.
   *
   * Returns a *string* rather than a number because the original did, and the
   * value is written straight into the overlay. `currentPercentage()` exposes
   * the numeric form for callers that need to compute with it.
   *
   * @param {WeatherReading} weather
   * @returns {string} The score fixed to the configured number of decimals.
   */
  function computePercentage(weather) {
    const rain = parseFloat(weather.rain) || p.defaults.rain;
    const temperature =
      parseFloat(weather.temperature_2m) ||
      parseFloat(weather.temperature) ||
      p.defaults.temperature;
    const humidity = parseFloat(weather.relative_humidity_2m) || p.defaults.humidity;

    // Start near the midpoint with a deliberate random swing, so repeated
    // clicks on one location do not read as a single authoritative figure.
    let score = p.base + (p.jitter.min + random() * p.jitter.range);
    score += (temperature - p.temperature.reference) * p.temperature.coefficient;
    score -= rain * p.rain.coefficient;
    score += (p.humidity.reference - humidity) * p.humidity.coefficient;

    if (score < p.clamp.min) score = p.clamp.min;
    if (score > p.clamp.max) score = p.clamp.max;

    const fixed = score.toFixed(p.decimals);
    latestPercentage = parseFloat(fixed);
    return fixed;
  }

  /** @returns {number | null} The last percentage, or null if none yet. */
  function currentPercentage() {
    return latestPercentage;
  }

  /**
   * Convert the latest percentage into a radius multiplier.
   *
   * Before any weather has been fetched this falls back to the configured
   * default, which is chosen to equal the pivot so the multiplier is exactly
   * 1.0 and the very first fire drawn on entering the map is unscaled.
   *
   * @returns {number}
   */
  function growthFactor() {
    const percentage = latestPercentage ?? f.default;
    const factor = 1 + (percentage - f.pivot) * f.perPercent;
    if (!f.clamp.enabled) return factor;
    return Math.max(f.clamp.min, Math.min(f.clamp.max, factor));
  }

  return { computePercentage, currentPercentage, growthFactor };
}
