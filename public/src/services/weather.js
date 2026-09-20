/**
 * Open-Meteo current-conditions client.
 *
 * Separated from the map so the URL construction and the response shaping can
 * be reasoned about without Leaflet in the picture. The module knows nothing
 * about overlays or polygons; it returns data and lets callers decide.
 */

/**
 * @typedef {object} WeatherConfig The `weather` block of `site.config.json`.
 * @property {string} endpoint
 * @property {string} timezone
 * @property {string[]} hourly
 * @property {string[]} current
 * @property {Array<{ key: string, label: string, unit: string }>} readout
 * @property {Array<{ key: string, label: string, unit: string }>} legacyReadout
 * @property {string} noDataMessage
 */

/**
 * Build the forecast request URL.
 *
 * The `hourly` series are requested even though only the `current` block is
 * displayed today. That was true of the original and is kept: the series are
 * logged to the console and were evidently intended for the timeline view that
 * was never finished.
 *
 * @param {WeatherConfig} config
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
export function buildWeatherUrl(config, lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: config.hourly.join(","),
    timezone: config.timezone,
    current: config.current.join(","),
  });
  return `${config.endpoint}?${params}`;
}

/**
 * Fetch current conditions for a point.
 *
 * @param {WeatherConfig} config
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<object>} The raw Open-Meteo response.
 */
export async function fetchWeather(config, lat, lng) {
  const response = await fetch(buildWeatherUrl(config, lat, lng));
  return response.json();
}

/**
 * Pick whichever current-conditions block the response actually carries.
 *
 * Open-Meteo's newer `current` object and its older `current_weather` object
 * use different field names for the same quantities, so the readout table to
 * use depends on which one came back. Returning the table alongside the values
 * keeps that decision in one place instead of branching at every call site.
 *
 * @param {WeatherConfig} config
 * @param {object} response
 * @returns {{ values: object | null, readout: Array<{key: string, label: string, unit: string}> }}
 */
export function selectReading(config, response) {
  if (response.current) return { values: response.current, readout: config.readout };
  if (response.current_weather) {
    return { values: response.current_weather, readout: config.legacyReadout };
  }
  return { values: null, readout: [] };
}
