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
 * Format a reading as the overlay's lines of text.
 *
 * Rows come from configuration rather than being eight hard-coded string
 * concatenations, which is what makes adding or reordering a reading a data
 * change. A row whose key is absent from the response still renders, showing
 * `undefined`, exactly as the original did.
 *
 * @param {object | null} values The API's current-conditions object.
 * @param {Array<{ key: string, label: string, unit: string }>} readout
 * @param {string} noDataMessage Shown when no readable block came back.
 * @returns {string[]} One line per row, or a single line when there is no data.
 */
export function formatReadout(values, readout, noDataMessage) {
  if (!values) return [noDataMessage];
  return readout.map((row) => `${row.label}: ${values[row.key]}${row.unit}`);
}

/**
 * Render a bold heading followed by lines of plain text into an element.
 *
 * WAS BROKEN: both overlays were written with innerHTML, interpolating values
 * straight from the weather API into markup. That is the same hole that was
 * closed in the marker popups, left open here. It is the less likely of the
 * two to be exploited, since Open-Meteo returns numbers, but "the upstream
 * currently sends numbers" is not a security boundary: any string the API
 * returns, now or later, was parsed as HTML.
 *
 * Building nodes and assigning textContent means API values can never be
 * markup. Each line gets its own <div> instead of a trailing <br>, which
 * renders the same because the overlay is a block container.
 *
 * @param {HTMLElement} element
 * @param {string} heading
 * @param {string[]} lines
 */
function renderPanel(element, heading, lines) {
  const doc = element.ownerDocument;
  const strong = doc.createElement("strong");
  strong.textContent = heading;

  const body = lines.map((line) => {
    const div = doc.createElement("div");
    div.textContent = line;
    return div;
  });

  element.replaceChildren(strong, ...body);
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
      renderPanel(weatherEl, heading, formatReadout(values, readout, config.noDataMessage));
    },

    /**
     * Show the computed growth score.
     * @param {string} percentage Pre-formatted by the growth model.
     */
    showGrowth(percentage) {
      // One line, appended to the label rather than stacked under it, so the
      // growth panel keeps reading as a single sentence.
      const strong = growthEl.ownerDocument.createElement("strong");
      strong.textContent = copy.growthLabel;
      growthEl.replaceChildren(strong, ` ${percentage}${copy.growthSuffix}`);
    },
  };
}
