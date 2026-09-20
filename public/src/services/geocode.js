/**
 * Reverse geocoding via OpenStreetMap Nominatim.
 *
 * Used only to replace raw coordinates in a marker popup with a place name.
 * Because it is cosmetic, every failure path here degrades to a label rather
 * than propagating: a popup that says "Unknown location" is better than a popup
 * that fails to update at all.
 */

/**
 * @typedef {object} GeocodingConfig The `geocoding` block of `site.config.json`.
 * @property {string} endpoint
 * @property {string[]} placeKeys Address fields to try, most specific first.
 * @property {string} unknownPlaceLabel
 */

/**
 * Choose the best available place name from a Nominatim address object.
 *
 * Nominatim's granularity varies with how populated the area is, and wildfires
 * are usually nowhere near a city. Walking from `city` down to `county` means
 * remote events still get a recognisable name instead of nothing.
 *
 * @param {object | undefined} address
 * @param {GeocodingConfig} config
 * @returns {string}
 */
export function selectPlaceName(address, config) {
  for (const key of config.placeKeys) {
    const value = address?.[key];
    if (value) return value;
  }
  return config.unknownPlaceLabel;
}

/**
 * Look up a place name for a coordinate pair.
 *
 * @param {GeocodingConfig} config
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string>} A place name, or the configured unknown label.
 */
export async function reverseGeocode(config, lat, lng) {
  const response = await fetch(`${config.endpoint}&lat=${lat}&lon=${lng}`);
  const data = await response.json();
  return selectPlaceName(data.address, config);
}
