import test from "node:test";
import assert from "node:assert/strict";
import { buildWeatherUrl, selectReading } from "../public/src/services/weather.js";
import { impactRadiusFor, parseFireEvents } from "../public/src/services/eonet.js";
import { selectPlaceName } from "../public/src/services/geocode.js";
import { formatReadout } from "../public/src/ui/overlays.js";
import { loadData } from "./helpers/leaflet-stub.mjs";

const site = await loadData("site.config.json");

/* ------------------------------------------------------------------ weather */

test("the weather URL carries the coordinates and every requested field", () => {
  const url = new URL(buildWeatherUrl(site.weather, 34.0522, -118.2437));
  assert.equal(url.origin + url.pathname, site.weather.endpoint);
  assert.equal(url.searchParams.get("latitude"), "34.0522");
  assert.equal(url.searchParams.get("longitude"), "-118.2437");
  assert.equal(url.searchParams.get("timezone"), site.weather.timezone);
  assert.deepEqual(url.searchParams.get("current").split(","), site.weather.current);
  assert.deepEqual(url.searchParams.get("hourly").split(","), site.weather.hourly);
});

test("negative and zero coordinates survive URL construction", () => {
  const url = new URL(buildWeatherUrl(site.weather, 0, 0));
  assert.equal(url.searchParams.get("latitude"), "0");
  assert.equal(url.searchParams.get("longitude"), "0");
});

test("the modern current block is preferred over the legacy one", () => {
  const { values, readout } = selectReading(site.weather, {
    current: { temperature_2m: 22 },
    current_weather: { temperature: 99 },
  });
  assert.equal(values.temperature_2m, 22);
  assert.equal(readout, site.weather.readout);
});

test("the legacy current_weather block is used when it is all that is offered", () => {
  const { values, readout } = selectReading(site.weather, { current_weather: { temperature: 18 } });
  assert.equal(values.temperature, 18);
  assert.equal(readout, site.weather.legacyReadout);
});

test("a response with neither block yields no reading", () => {
  const { values, readout } = selectReading(site.weather, {});
  assert.equal(values, null);
  assert.deepEqual(readout, []);
});

/* ----------------------------------------------------------------- overlays */

test("the readout returns one labelled line per configured row", () => {
  const lines = formatReadout({ rain: 0, temperature_2m: 22 },
    [{ key: "rain", label: "Rain", unit: " mm" }, { key: "temperature_2m", label: "Temperature", unit: "°C" }],
    site.weather.noDataMessage);
  // Plain strings, not markup. The overlay turns each one into its own node,
  // so a value from the API can never be parsed as HTML.
  assert.deepEqual(lines, ["Rain: 0 mm", "Temperature: 22°C"]);
  assert.ok(lines.every((line) => !line.includes("<")), "lines must carry no markup");
});

test("the readout falls back to the no-data message", () => {
  assert.deepEqual(formatReadout(null, site.weather.readout, site.weather.noDataMessage),
    [site.weather.noDataMessage]);
});

test("every configured readout key is actually requested from the API", () => {
  // Guards the data file against a row that would always render "undefined".
  for (const row of site.weather.readout) {
    assert.ok(site.weather.current.includes(row.key), `${row.key} is displayed but never requested`);
  }
});

/* -------------------------------------------------------------------- eonet */

test("burn area in acres becomes a circle radius in metres", () => {
  // 1 acre = 4046.8564224 m^2, so radius = sqrt(area / pi).
  const oneAcre = impactRadiusFor(1, site.eonet);
  assert.ok(Math.abs(oneAcre - Math.sqrt(4046.8564224 / Math.PI)) < 1e-9);
  // Quadrupling the area should double the radius.
  assert.ok(Math.abs(impactRadiusFor(400, site.eonet) / impactRadiusFor(100, site.eonet) - 2) < 1e-9);
});

test("an event with no reported magnitude uses the fallback radius", () => {
  assert.equal(impactRadiusFor(undefined, site.eonet), site.eonet.fallbackImpactRadiusMetres);
  assert.equal(impactRadiusFor(null, site.eonet), site.eonet.fallbackImpactRadiusMetres);
  assert.equal(impactRadiusFor(0, site.eonet), site.eonet.fallbackImpactRadiusMetres);
});

test("the most recent geometry of an event is the one plotted", () => {
  // EONET lists observations chronologically; the latest is the current state.
  const [event] = parseFireEvents({ events: [{ title: "Creek Fire", geometry: [
    { date: "2025-01-01T00:00:00Z", coordinates: [-100, 40] },
    { date: "2025-08-01T00:00:00Z", coordinates: [-118.5, 34.5], magnitudeValue: 500 },
  ] }] }, site.eonet);
  assert.equal(event.date, "2025-08-01T00:00:00Z");
  assert.equal(event.lat, 34.5);
  assert.equal(event.lng, -118.5);
});

test("GeoJSON coordinates are swapped into lat/lng order", () => {
  // EONET gives [longitude, latitude]; getting this backwards would put
  // Californian fires in the Indian Ocean.
  const [event] = parseFireEvents({ events: [{ title: "X", geometry: [
    { date: "2025-06-01T00:00:00Z", coordinates: [-118.2437, 34.0522] },
  ] }] }, site.eonet);
  assert.equal(event.lat, 34.0522);
  assert.equal(event.lng, -118.2437);
});

test("events older than the configured year are dropped", () => {
  const events = parseFireEvents({ events: [
    { title: "Old", geometry: [{ date: "2024-12-31T00:00:00Z", coordinates: [-118, 34] }] },
    { title: "New", geometry: [{ date: "2025-01-01T12:00:00Z", coordinates: [-118, 34] }] },
  ] }, site.eonet);
  assert.deepEqual(events.map((e) => e.title), ["New"]);
});

test("an empty or malformed events payload yields no events rather than throwing", () => {
  assert.deepEqual(parseFireEvents({ events: [] }, site.eonet), []);
  assert.deepEqual(parseFireEvents({}, site.eonet), []);
  assert.deepEqual(parseFireEvents(null, site.eonet), []);
});

/* ------------------------------------------------------------------ geocode */

test("the most specific available place name wins", () => {
  const c = site.geocoding;
  assert.equal(selectPlaceName({ city: "Fresno", town: "T", county: "Fresno County" }, c), "Fresno");
  assert.equal(selectPlaceName({ town: "Paradise", county: "Butte County" }, c), "Paradise");
  assert.equal(selectPlaceName({ county: "Butte County" }, c), "Butte County");
});

test("a missing or empty address degrades to the unknown label", () => {
  const c = site.geocoding;
  assert.equal(selectPlaceName(undefined, c), c.unknownPlaceLabel);
  assert.equal(selectPlaceName({}, c), c.unknownPlaceLabel);
  assert.equal(selectPlaceName({ city: "" }, c), c.unknownPlaceLabel);
});
