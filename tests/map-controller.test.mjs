import test from "node:test";
import assert from "node:assert/strict";
import { createMapController } from "../public/src/map/map-controller.js";
import { createLeafletStub, loadData } from "./helpers/leaflet-stub.mjs";

const site = await loadData("site.config.json");
const phases = await loadData("fire-phases.json");

/**
 * Minimal DOM stand-in, enough for the popup builder.
 *
 * Only createElement, textContent, append and addEventListener are used, and
 * `html` serialises with escaping so the tests can assert that untrusted text
 * is never parsed as markup.
 */
class StubElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this._text = "";
    this.className = "";
    this.type = "";
    this.listeners = {};
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  /** Serialise with HTML escaping, the way textContent actually behaves. */
  get html() {
    const escaped = this._text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inner = this._text ? escaped : this.children.map((c) => (typeof c === "string" ? c : c.html)).join("");
    return `<${this.tag}>${inner}</${this.tag}>`;
  }
  /** Depth-first search for the first descendant with a given class. */
  find(className) {
    if (this.className === className) return this;
    for (const child of this.children) {
      if (typeof child === "string") continue;
      const hit = child.find?.(className);
      if (hit) return hit;
    }
    return null;
  }
}

/**
 * Install a stub document for the duration of a test.
 *
 * Must await `fn` before restoring: with a plain try/finally an async callback
 * returns its pending promise immediately, so the stub would be torn down while
 * the code under test was still building popups.
 */
async function withDocument(fn) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new StubElement(tag) };
  try {
    return await fn();
  } finally {
    globalThis.document = previous;
  }
}

/** Build a controller over stubbed Leaflet, fetch and DOM. */
function harness({ leafletOptions = {}, responses = {} } = {}) {
  const { L, record } = createLeafletStub(leafletOptions);
  const overlayCalls = { weather: [], growth: [] };
  const growthCalls = [];

  globalThis.requestAnimationFrame = () => {};
  globalThis.fetch = async (url) => {
    const key = String(url).includes("eonet") ? "eonet"
      : String(url).includes("nominatim") ? "geocode" : "weather";
    const body = responses[key] ?? (key === "eonet" ? { events: [] } : {});
    return { ok: true, json: async () => body };
  };

  const controller = createMapController({
    L,
    config: site,
    phases,
    growth: {
      growthFactor: () => 1,
      computePercentage: (values) => {
        growthCalls.push(values);
        return "50.0";
      },
    },
    overlays: {
      showWeather: (...args) => overlayCalls.weather.push(args),
      showGrowth: (...args) => overlayCalls.growth.push(args),
    },
  });
  return { controller, record, overlayCalls, growthCalls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("init builds the map from configuration", async () => {
  const { controller, record } = harness();
  controller.init();
  await settle();
  assert.deepEqual(record.view.center, site.map.initialCenter);
  assert.equal(record.view.zoom, site.map.initialZoom);
  assert.equal(record.tileLayers[0].url, site.map.tileLayer.urlTemplate);
  assert.equal(record.tileLayers[0].options.attribution, site.map.tileLayer.attribution);
});

test("init draws one fire immediately so the view is never empty", async () => {
  const { controller, record } = harness();
  controller.init();
  await settle();
  assert.ok(record.polygons.length > 0, "a default fire should be drawn on arrival");
});

test("re-entering the map view does not construct a second map", async () => {
  // REGRESSION: init() used to run unconditionally on every entry, so the
  // second visit threw "Map container is already initialized" and left the map
  // dead. The stub throws exactly as Leaflet does.
  const { controller, record } = harness({ leafletOptions: { throwOnSecondMap: true } });
  controller.init();
  controller.init();
  controller.init();
  await settle();
  assert.equal(record.mapCreations, 1);
  assert.equal(record.invalidateSizeCalls, 2, "re-entry must refresh the cached container size");
});

test("clicking the map starts a fire and requests weather for that point", async () => {
  const { controller, record, overlayCalls } = harness({
    responses: { weather: { current: { temperature_2m: 22, wind_direction_10m: 90 } } },
  });
  controller.init();
  await settle();
  const before = record.polygons.length;
  record.clickHandlers[0]({ latlng: { lat: 37.7749, lng: -122.4194 } });
  await settle();
  assert.ok(record.polygons.length > before);
  const [lat, lng] = overlayCalls.weather[overlayCalls.weather.length - 1];
  assert.equal(lat, 37.7749);
  assert.equal(lng, -122.4194);
});

test("both overlays are updated from a weather response", async () => {
  const { controller, overlayCalls } = harness({
    responses: { weather: { current: { temperature_2m: 22, wind_direction_10m: 90 } } },
  });
  controller.init();
  await controller.loadWeather(34, -118);
  assert.equal(overlayCalls.weather.length, 1);
  assert.equal(overlayCalls.growth.length, 1);
  assert.equal(overlayCalls.growth[0][0], "50.0");
});

test("a weather failure is contained and does not propagate", async () => {
  // The readout is informational; a fire already animating must not be torn
  // down because a panel could not refresh.
  const { controller } = harness();
  controller.init();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  await assert.doesNotReject(() => controller.loadWeather(34, -118));
});

test("a response with no readable block still renders, without throwing", async () => {
  const { controller, overlayCalls, growthCalls } = harness({ responses: { weather: {} } });
  controller.init();
  await controller.loadWeather(34, -118);
  assert.equal(overlayCalls.weather[0][2], null, "no values should be reported as null");
  assert.deepEqual(growthCalls[0], {}, "the growth model should receive an empty reading");
});

test("EONET events become a marker and an impact circle each", async () => {
  await withDocument(async () => {
    const { controller, record } = harness({
      responses: { eonet: { events: [
        { title: "Creek Fire", geometry: [{ date: "2025-08-01T00:00:00Z", coordinates: [-119.2, 37.2], magnitudeValue: 100 }] },
        { title: "Old Fire", geometry: [{ date: "2020-01-01T00:00:00Z", coordinates: [-118, 34] }] },
      ] } },
    });
    controller.init();
    await settle();
    assert.equal(record.markers.length, 1, "the pre-2025 event should be filtered out");
    assert.equal(record.circles.length, 1);
    assert.deepEqual(record.markers[0].coords, [37.2, -119.2]);
    assert.equal(record.circles[0].options.color, site.eonet.impactCircleStyle.color);
    assert.equal(record.circles[0].options.fillOpacity, site.eonet.impactCircleStyle.fillOpacity);
  });
});

test("a hostile event title is rendered as text, never as markup", async () => {
  // REGRESSION: popups were HTML strings interpolating third-party text, and
  // Leaflet inserts popup content with innerHTML. Nominatim place names come
  // from world-editable OpenStreetMap data, making this a real injection path.
  await withDocument(async () => {
    const { controller, record } = harness({
      responses: { eonet: { events: [{
        title: '<img src=x onerror="alert(1)">',
        geometry: [{ date: "2025-08-01T00:00:00Z", coordinates: [-119, 37] }],
      }] } },
    });
    controller.init();
    await settle();
    const popup = record.markers[0].popup;
    assert.notEqual(typeof popup, "string", "the popup must be a node, not an HTML string");
    assert.ok(popup.html.includes("&lt;img"), "the tag must be escaped");
    assert.ok(!popup.html.includes("<img"), "no live img element may be produced");
  });
});

test("the simulate button carries a listener rather than an inline attribute", async () => {
  await withDocument(async () => {
    const { controller, record } = harness({
      responses: { eonet: { events: [{
        title: "Creek Fire",
        geometry: [{ date: "2025-08-01T00:00:00Z", coordinates: [-119, 37], magnitudeValue: 100 }],
      }] } },
    });
    controller.init();
    await settle();
    const button = record.markers[0].popup.find("popup-simulate");
    assert.ok(button, "the popup should contain a simulate button");
    assert.equal(button.textContent, site.eonet.simulateButtonLabel);
    assert.equal(typeof button.listeners.click, "function");
    assert.equal(globalThis.simulateExistingFireAt, undefined, "no global should be exported");

    const before = record.polygons.length;
    button.listeners.click();
    await settle();
    assert.ok(record.polygons.length > before, "pressing simulate should draw a fire");
  });
});

test("clicking a marker replaces the coordinates with a resolved place name", async () => {
  await withDocument(async () => {
    const { controller, record } = harness({
      responses: {
        eonet: { events: [{ title: "Creek Fire", geometry: [{ date: "2025-08-01T00:00:00Z", coordinates: [-119, 37] }] }] },
        geocode: { address: { county: "Fresno County" } },
      },
    });
    controller.init();
    await settle();
    assert.ok(record.markers[0].popup.textContent.includes("37.0000"), "starts with coordinates");
    record.markers[0].handlers.click();
    await settle();
    assert.ok(record.markers[0].popup.textContent.includes("Fresno County"));
  });
});
