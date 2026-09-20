/**
 * NASA EONET wildfire-event client.
 *
 * EONET reports each event as a list of successive geometries -- one per
 * observation -- so a small amount of interpretation is needed before the data
 * is usable as map markers. That interpretation lives here rather than inside
 * the map so it can be tested against recorded payloads.
 */

/**
 * A wildfire event reduced to what the map needs.
 * @typedef {object} FireEvent
 * @property {string} title
 * @property {number} lat
 * @property {number} lng
 * @property {string} date ISO timestamp of the observation used.
 * @property {number} impactRadiusMetres
 */

/**
 * Convert a reported burn area into a circle radius.
 *
 * EONET gives wildfire magnitude in acres. Treating the burn as a circle,
 * radius = sqrt(area / pi). Events frequently omit the magnitude entirely,
 * which is why a fallback is configured rather than the marker being skipped --
 * an unsized fire is still a fire worth showing.
 *
 * @param {number | undefined | null} magnitudeAcres
 * @param {{ acresToSquareMetres: number, fallbackImpactRadiusMetres: number }} config
 * @returns {number} Radius in metres.
 */
export function impactRadiusFor(magnitudeAcres, config) {
  return magnitudeAcres
    ? Math.sqrt((magnitudeAcres * config.acresToSquareMetres) / Math.PI)
    : config.fallbackImpactRadiusMetres;
}

/**
 * Reduce a raw EONET response to the events the map should draw.
 *
 * Two decisions are encoded here. The *last* geometry of each event is used
 * because the list is chronological and the most recent observation is the one
 * worth plotting. Events older than the configured year are dropped, which is
 * how the map stays focused on the current season -- note this is a fixed year
 * from configuration, not a rolling window.
 *
 * Coordinates arrive as `[longitude, latitude]` (GeoJSON order) and are
 * swapped here, once, rather than at each use.
 *
 * @param {object} response Parsed EONET v3 payload.
 * @param {object} config The `eonet` block of `site.config.json`.
 * @returns {FireEvent[]}
 */
export function parseFireEvents(response, config) {
  const events = response?.events ?? [];
  const parsed = [];
  for (const event of events) {
    const geometry = event.geometry[event.geometry.length - 1];
    if (new Date(geometry.date).getFullYear() < config.minEventYear) continue;
    const [lng, lat] = geometry.coordinates;
    parsed.push({
      title: event.title,
      lat,
      lng,
      date: geometry.date,
      impactRadiusMetres: impactRadiusFor(geometry.magnitudeValue, config),
    });
  }
  return parsed;
}

/**
 * Fetch and parse currently open wildfire events.
 *
 * @param {object} config The `eonet` block of `site.config.json`.
 * @returns {Promise<FireEvent[]>}
 */
export async function fetchFireEvents(config) {
  const response = await fetch(config.endpoint);
  return parseFireEvents(await response.json(), config);
}
