/**
 * The map view: Leaflet setup, EONET markers, click handling and the wiring
 * between weather, the growth model and the fire animation.
 *
 * This is the only module that touches Leaflet directly besides the animator,
 * which is why the services and the growth model are handed to it rather than
 * imported here. It composes them, it does not own them.
 */

import { createFireAnimator } from "./fire-animation.js";
import { createPolygonStore } from "./polygon-store.js";
import { fetchFireEvents } from "../services/eonet.js";
import { reverseGeocode } from "../services/geocode.js";
import { fetchWeather, selectReading } from "../services/weather.js";

/**
 * Build an EONET marker popup as a DOM node.
 *
 * WAS BROKEN: this popup was assembled as an HTML string that interpolated the
 * EONET event title and the Nominatim place name directly into markup, then
 * handed to Leaflet, which inserts it with innerHTML. Both strings come from
 * third parties. The place name is the dangerous one: Nominatim serves
 * OpenStreetMap data, which anyone can edit, so a crafted place name was a
 * script-injection vector into this page. No authentication needed, just an
 * OSM edit near a wildfire.
 *
 * Building nodes and assigning textContent closes that: the strings are now
 * unconditionally treated as text, never parsed as markup.
 *
 * The simulate button also gets a real listener instead of an inline onclick
 * attribute. Besides removing a second injection surface (the coordinates were
 * interpolated into an attribute), this is what lets the handler stop being a
 * global: inline handlers can only resolve names on window.
 *
 * @param {object} params
 * @param {string} params.title Event title, from EONET.
 * @param {Node[]} params.subtitle Pre-built subtitle nodes.
 * @param {string} params.buttonLabel
 * @param {() => void} params.onSimulate
 * @returns {HTMLElement}
 */
function buildPopup({ title, subtitle, buttonLabel, onSimulate }) {
  const container = document.createElement("div");

  const heading = document.createElement("b");
  heading.textContent = title;

  const actions = document.createElement("div");
  actions.className = "popup-actions";
  const button = document.createElement("button");
  button.className = "popup-simulate";
  button.type = "button";
  button.textContent = buttonLabel;
  button.addEventListener("click", onSimulate);
  actions.append(button);

  container.append(heading, document.createElement("br"), ...subtitle, actions);
  return container;
}

/**
 * Build the subtitle lines of a popup: a timestamp, then a location.
 *
 * Returned as nodes rather than a string for the same reason as above, the
 * place name being untrusted, and kept separate so the initial popup and the
 * geocoded rewrite cannot drift apart.
 *
 * @param {string} timestamp Already localised.
 * @param {string} location Coordinates, or a resolved place name.
 * @returns {Node[]}
 */
function buildSubtitle(timestamp, location) {
  const line = document.createElement("div");
  line.textContent = timestamp;
  const place = document.createElement("div");
  place.textContent = `Location: ${location}`;
  return [line, place];
}

/**
 * Create the map controller.
 *
 * @param {object} deps
 * @param {object} deps.L Leaflet namespace.
 * @param {object} deps.config Parsed `data/site.config.json`.
 * @param {object} deps.phases Parsed `data/fire-phases.json`.
 * @param {object} deps.growth Growth model from `core/growth.js`.
 * @param {object} deps.overlays Overlay bindings from `ui/overlays.js`.
 */
export function createMapController({ L, config, phases, growth, overlays }) {
  /** @type {object | null} The Leaflet map, created on first entry to the view. */
  let map = null;

  /**
   * Latest wind bearing in degrees, used to bend the fire shape downwind.
   *
   * Module state rather than a parameter because a fire already animating must
   * pick up a newer reading on its next frame; the animator reads it through a
   * getter for exactly that reason.
   */
  let windDirection = 0;

  const store = createPolygonStore();
  /** @type {object | null} */
  let animator = null;

  /**
   * Fetch conditions for a point, update both overlays and remember the wind.
   *
   * Failures are logged and swallowed: the weather panel is informational, and
   * a fire simulation already under way should not be interrupted because a
   * readout could not be refreshed.
   *
   * @param {number} lat
   * @param {number} lng
   */
  async function loadWeather(lat, lng) {
    try {
      const data = await fetchWeather(config.weather, lat, lng);
      console.log("Weather API Data:", data);

      const { values, readout } = selectReading(config.weather, data);
      /*
       * WAS BROKEN: this tested the bearing for truthiness before storing it.
       * A bearing of 0 is falsy, so a wind blowing from due north was thrown
       * away. It is one of the 360 legal values, and the one a calm reading
       * often reports. Losing it left the fire bent by whatever the PREVIOUS
       * location's wind had been. The stale value then silently steered the spread shape
       * at the new location.
       *
       * Test that the parse produced a number instead, so 0 is kept and only a
       * genuinely absent or unparseable bearing is ignored.
       */
      const bearing = parseFloat(values?.wind_direction_10m);
      if (!Number.isNaN(bearing)) windDirection = bearing;

      overlays.showWeather(lat, lng, values, readout);
      overlays.showGrowth(growth.computePercentage(values ?? {}));
    } catch (error) {
      console.error("Error fetching weather data:", error);
    }
  }

  /**
   * Start a fresh simulated fire at an arbitrary point.
   *
   * The polygon stack is reset first so the final re-ordering applies only to
   * this fire and not to everything previously drawn.
   *
   * @param {object} center A Leaflet LatLng.
   */
  function startClickedFire(center) {
    const sequence = phases.sequences.clicked;
    store.reset();
    animator.run("clicked", center, sequence.baseRadiusMetres * growth.growthFactor());
  }

  /**
   * Start a simulation seeded from a real event's reported burn radius.
   *
   * Note this does NOT reset the polygon stack, matching the original: repeated
   * simulations of existing fires accumulate.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} initialRadius Metres, from the event's magnitude.
   */
  function simulateExistingFireAt(lat, lng, initialRadius) {
    animator.run("existing", L.latLng(lat, lng), initialRadius * growth.growthFactor());
    loadWeather(lat, lng);
  }

  /** Draw one EONET event: emoji marker, popup, and its impact circle. */
  function addFireEventMarker(event) {
    const { marker: markerConfig, simulateButtonLabel } = config.eonet;
    const icon = L.divIcon({
      html: markerConfig.html,
      className: markerConfig.className,
      iconSize: markerConfig.iconSize,
      iconAnchor: markerConfig.iconAnchor,
    });

    const timestamp = new Date(event.date).toLocaleString();
    const popupFor = (location) =>
      buildPopup({
        title: event.title,
        subtitle: buildSubtitle(timestamp, location),
        buttonLabel: simulateButtonLabel,
        onSimulate: () =>
          simulateExistingFireAt(event.lat, event.lng, event.impactRadiusMetres),
      });

    const marker = L.marker([event.lat, event.lng], { icon }).addTo(map);
    const decimals = config.weather.coordinateDecimals;
    marker.bindPopup(popupFor(`${event.lat.toFixed(decimals)}, ${event.lng.toFixed(decimals)}`));

    // The place name is resolved lazily on click rather than up front: there
    // can be dozens of events and Nominatim asks callers not to bulk-query it.
    marker.on("click", () => {
      reverseGeocode(config.geocoding, event.lat, event.lng)
        .then((place) => marker.getPopup().setContent(popupFor(place)))
        .catch((error) => console.error("Reverse geocoding error:", error));
    });

    L.circle([event.lat, event.lng], {
      radius: event.impactRadiusMetres,
      ...config.eonet.impactCircleStyle,
    }).addTo(map);
  }

  /** Load and draw every qualifying open wildfire event. */
  function loadFireEvents() {
    fetchFireEvents(config.eonet)
      .then((events) => events.forEach(addFireEventMarker))
      .catch((error) => console.error("Error fetching wildfire data:", error));
  }

  /**
   * Create the map and populate it, or re-enter an already-created one.
   *
   * WAS BROKEN: this ran unconditionally every time the Predict view opened,
   * calling L.map() again on a container Leaflet had already initialised.
   * Leaflet throws "Map container is already initialized" in that case, so the
   * second visit (Predict, then About, then Predict) died with an exception
   * and left a dead map behind. Guarding on the existing instance fixes it.
   *
   * invalidateSize() is needed on re-entry because the section is display:none
   * while the landing page is showing. Leaflet caches the container size, and a
   * hidden container measures zero, so without this the tiles would lay out
   * against stale dimensions.
   *
   * @returns {object} The Leaflet map.
   */
  function init() {
    if (map) {
      map.invalidateSize();
      return map;
    }
    map = L.map("map").setView(config.map.initialCenter, config.map.initialZoom);
    L.tileLayer(config.map.tileLayer.urlTemplate, {
      attribution: config.map.tileLayer.attribution,
    }).addTo(map);

    animator = createFireAnimator({
      L,
      map,
      phases,
      windDirection: () => windDirection,
      store,
    });

    loadFireEvents();

    // Retained from the original as belt-and-braces: with the guard above,
    // init() now runs at most once, so there is never a stale listener to clear.
    map.off("click");
    map.on("click", (e) => {
      startClickedFire(e.latlng);
      loadWeather(e.latlng.lat, e.latlng.lng);
    });

    // Draw one fire immediately so the view is never empty on arrival.
    startClickedFire(L.latLng(...config.map.defaultFireCenter));
    return map;
  }

  return { init, simulateExistingFireAt, loadWeather };
}
