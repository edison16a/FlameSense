/**
 * The two floating readout panels on the map.
 *
 * Kept apart from the weather service so that "what we fetched" and "how we
 * present it" are separable. Both the readout rows and the surrounding copy
 * come from data, so relabelling a panel needs no code.
 */

/**
 * Fill `{name}` placeholders in a copy string.
 *
 * The content file stores headings with braces in them so the copy reads as a
 * whole sentence to whoever is editing it, instead of being split into
 * fragments that the code concatenates in an order they cannot see.
 *
 * @param {string} template Copy containing `{name}` placeholders.
 * @param {Record<string, string>} values
 * @returns {string} The template with every placeholder replaced.
 */
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? values[key] : match,
  );
}

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
 * @param {object} copy The `runtime` block of `content.json`.
 * @param {Document} [doc]
 */
export function createOverlays(config, copy, doc = document) {
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
      const heading = fillTemplate(copy.weatherHeading, {
        lat: lat.toFixed(config.coordinateDecimals),
        lng: lng.toFixed(config.coordinateDecimals),
      });
      weatherEl.innerHTML =
        `<strong>${heading}</strong><br>` +
        formatReadout(values, readout, config.noDataMessage);
    },

    /**
     * Show the computed growth score.
     * @param {string} percentage Pre-formatted by the growth model.
     */
    showGrowth(percentage) {
      growthEl.innerHTML = `<strong>${copy.growthLabel}</strong> ${percentage}${copy.growthSuffix}`;
    },
  };
}
