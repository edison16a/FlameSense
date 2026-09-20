/**
 * The map view: Leaflet setup, EONET markers, click handling and the wiring
 * between weather, the growth model and the fire animation.
 *
 * This is the only module that touches Leaflet directly besides the animator,
 * which is why the services and the growth model are handed to it rather than
 * imported here -- it composes them, it does not own them.
 */

import { createFireAnimator } from "./fire-animation.js";
import { createPolygonStore } from "./polygon-store.js";
import { fetchFireEvents } from "../services/eonet.js";
import { reverseGeocode } from "../services/geocode.js";
import { fetchWeather, selectReading } from "../services/weather.js";

/**
 * Build the HTML for an EONET marker popup.
 *
 * Defined once and used for both the initial popup and the version rewritten
 * after reverse geocoding, which in the original were two separate template
 * literals that had to be kept in step by hand -- the pill button's styling was
 * written out twice.
 *
 * @param {object} params
 * @param {string} params.title Event title.
 * @param {string} params.subtitle Either a timestamp or a resolved place name.
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {number} params.radius Impact radius in metres.
 * @param {string} params.buttonLabel
 * @returns {string}
 */
function buildPopupHtml({ title, subtitle, lat, lng, radius, buttonLabel }) {
  return (
    `<b>${title}</b><br>${subtitle}<br>` +
    `<div class="popup-actions">` +
    `<button class="popup-simulate" onclick="simulateExistingFireAt(${lat}, ${lng}, ${radius})">` +
    `${buttonLabel}</button></div>`
  );
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
      if (values && values.wind_direction_10m) {
        windDirection = parseFloat(values.wind_direction_10m);
      }

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

    const popupFor = (subtitle) =>
      buildPopupHtml({
        title: event.title,
        subtitle,
        lat: event.lat,
        lng: event.lng,
        radius: event.impactRadiusMetres,
        buttonLabel: simulateButtonLabel,
      });

    const marker = L.marker([event.lat, event.lng], { icon }).addTo(map);
    marker.bindPopup(
      popupFor(
        `${new Date(event.date).toLocaleString()}<br>` +
          `Location: ${event.lat.toFixed(config.weather.coordinateDecimals)}, ` +
          `${event.lng.toFixed(config.weather.coordinateDecimals)}`,
      ),
    );

    // The place name is resolved lazily on click rather than up front: there
    // can be dozens of events and Nominatim asks callers not to bulk-query it.
    marker.on("click", () => {
      reverseGeocode(config.geocoding, event.lat, event.lng)
        .then((place) => {
          marker
            .getPopup()
            .setContent(
              popupFor(`${new Date(event.date).toLocaleString()}<br>Location: ${place}`),
            );
        })
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
   * second visit -- Predict, then About, then Predict -- died with an
   * exception and left a dead map behind. Guarding on the existing instance
   * fixes it.
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
