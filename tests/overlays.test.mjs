import test from "node:test";
import assert from "node:assert/strict";
import { createOverlays, fillTemplate } from "../public/src/ui/overlays.js";
import { createStubDocument } from "./helpers/dom-stub.mjs";
import { loadData } from "./helpers/leaflet-stub.mjs";

const site = await loadData("site.config.json");
const content = await loadData("content.json");

function harness(copy = content.runtime) {
  const doc = createStubDocument();
  const overlays = createOverlays(site.weather, copy, doc);
  return {
    overlays,
    weather: doc.getElementById("timeOverlay"),
    growth: doc.getElementById("growthOverlay"),
  };
}

test("fillTemplate substitutes every known placeholder", () => {
  assert.equal(fillTemplate("Lat {lat}, Lng {lng}", { lat: "1.0", lng: "2.0" }), "Lat 1.0, Lng 2.0");
});

test("fillTemplate leaves an unknown placeholder alone", () => {
  // Better to show the raw brace than to silently blank it: a typo in the
  // content file stays visible instead of quietly dropping the coordinate.
  assert.equal(fillTemplate("Lat {lat}, {nope}", { lat: "1.0" }), "Lat 1.0, {nope}");
});

test("the weather heading is built from the content copy", () => {
  const { overlays, weather } = harness();
  overlays.showWeather(34.0522, -118.2437, { rain: 0 }, [{ key: "rain", label: "Rain", unit: " mm" }]);
  assert.equal(weather.children[0].tag, "strong");
  assert.equal(weather.children[0].textContent, "Current Data at Latitude 34.0522, Longitude -118.2437:");
});

test("coordinates are rounded to the configured precision", () => {
  const { overlays, weather } = harness();
  overlays.showWeather(1 / 3, -2 / 3, {}, []);
  assert.ok(weather.textContent.includes("0.3333"));
  assert.ok(weather.textContent.includes("-0.6667"));
});

test("one line is rendered per readout row", () => {
  const { overlays, weather } = harness();
  overlays.showWeather(0, 0, { rain: 0, temperature_2m: 22 }, [
    { key: "rain", label: "Rain", unit: " mm" },
    { key: "temperature_2m", label: "Temperature", unit: "°C" },
  ]);
  const lines = weather.children.slice(1).map((n) => n.textContent);
  assert.deepEqual(lines, ["Rain: 0 mm", "Temperature: 22°C"]);
});

test("a response with no readable block shows the no-data message", () => {
  const { overlays, weather } = harness();
  overlays.showWeather(0, 0, null, []);
  assert.equal(weather.children.at(-1).textContent, site.weather.noDataMessage);
});

test("API values are rendered as text and never as markup", () => {
  // REGRESSION: both overlays used innerHTML, so any string the weather API
  // returned was parsed as HTML. This is the same hole that was closed in the
  // marker popups.
  const { overlays, weather } = harness();
  overlays.showWeather(0, 0, { rain: "<img src=x onerror=alert(1)>" }, [
    { key: "rain", label: "Rain", unit: "" },
  ]);
  assert.ok(weather.html.includes("&lt;img"), "the tag must be escaped");
  assert.ok(!weather.html.includes("<img"), "no live element may be created");
});

test("a hostile heading in the content file is escaped too", () => {
  const { overlays, weather } = harness({ ...content.runtime, weatherHeading: "<b>{lat}</b>" });
  overlays.showWeather(1, 2, {}, []);
  assert.ok(weather.html.includes("&lt;b&gt;"));
});

test("the growth panel reads as one line", () => {
  const { overlays, growth } = harness();
  overlays.showGrowth("62.0");
  assert.equal(growth.children[0].tag, "strong");
  assert.equal(growth.children[0].textContent, content.runtime.growthLabel);
  assert.equal(growth.textContent, "Growth Percentage: 62.0%");
});

test("each render replaces the previous contents", () => {
  // Panels are refreshed on every click, so leftovers would stack up.
  const { overlays, weather } = harness();
  overlays.showWeather(0, 0, { rain: 1 }, [{ key: "rain", label: "Rain", unit: "" }]);
  overlays.showWeather(0, 0, { rain: 2 }, [{ key: "rain", label: "Rain", unit: "" }]);
  assert.equal(weather.children.length, 2, "heading plus one line");
  assert.ok(weather.textContent.includes("Rain: 2"));
  assert.ok(!weather.textContent.includes("Rain: 1"));
});

test("relabelling the copy needs no code change", () => {
  const { overlays, growth } = harness({ ...content.runtime, growthLabel: "Spread score:", growthSuffix: " pts" });
  overlays.showGrowth("40.0");
  assert.equal(growth.textContent, "Spread score: 40.0 pts");
});
