/**
 * The two floating readout panels on the map.
 *
 * Kept apart from the weather service so that "what we fetched" and "how we
 * present it" are separable; the readout rows themselves come from
 * `site.config.json`, so adding a field to the panel needs no code.
 */

/**
 * Format a reading as the overlay's `<br>`-separated lines.
 *
 * Rows come from configuration rather than being eight hard-coded string
 * concatenations, which is what makes adding or reordering a reading a data
 * change. A row whose key is absent from the response still renders, showing
 * `undefined`, exactly as the original did.
 *
 * @param {object | null} values The API's current-conditions object.
 * @param {Array<{ key: string, label: string, unit: string }>} readout
 * @param {string} noDataMessage Shown when no readable block came back.
 * @returns {string} HTML fragment.
 */
export function formatReadout(values, readout, noDataMessage) {
  if (!values) return noDataMessage;
  return readout.map((row) => `${row.label}: ${values[row.key]}${row.unit}<br>`).join("");
}

/**
 * Create bindings to the two overlay elements.
 *
 * @param {object} config The `weather` block of `site.config.json`.
 * @param {Document} [doc]
 */
export function createOverlays(config, doc = document) {
  const weatherEl = doc.getElementById("timeOverlay");
  const growthEl = doc.getElementById("growthOverlay");

  return {
    /**
     * Show current conditions for a point.
     *
     * @param {number} lat
     * @param {number} lng
     * @param {object | null} values
     * @param {Array<{ key: string, label: string, unit: string }>} readout
     */
    showWeather(lat, lng, values, readout) {
      const heading =
        `<strong>Current Data at Latitude ${lat.toFixed(config.coordinateDecimals)}, ` +
        `Longitude ${lng.toFixed(config.coordinateDecimals)}:</strong><br>`;
      weatherEl.innerHTML = heading + formatReadout(values, readout, config.noDataMessage);
    },

    /**
     * Show the computed growth score.
     * @param {string} percentage Pre-formatted by the growth model.
     */
    showGrowth(percentage) {
      growthEl.innerHTML = `<strong>Growth Percentage:</strong> ${percentage}%`;
    },
  };
}
