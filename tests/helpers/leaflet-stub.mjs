/**
 * A stub of the small slice of Leaflet this project uses.
 *
 * WHY a hand-written stub rather than a DOM emulator: the map code only ever
 * calls about eight Leaflet methods, and what the tests need to assert is which
 * shapes were drawn, in what order, with what styles. Recording those calls
 * directly is both simpler and a stronger assertion than rendering into a fake
 * browser and reading pixels back.
 */

/** A recorded polygon, exposing the full history of what was drawn on it. */
class StubPolygon {
  constructor(vertices, style, record) {
    this.vertices = vertices.map((v) => [...v]);
    /** Every style ever applied, oldest first. */
    this.styles = [style];
    this.record = record;
  }
  addTo() {
    return this;
  }
  setLatLngs(vertices) {
    this.vertices = vertices.map((v) => [...v]);
  }
  setStyle(style) {
    this.styles.push(style);
  }
  bringToFront() {
    this.record.frontOrder.push(this);
  }
  /** Colour this polygon currently shows. */
  get color() {
    return this.styles[this.styles.length - 1].color;
  }
  /** Colour it was first drawn with. */
  get initialColor() {
    return this.styles[0].color;
  }
}

/**
 * Create a Leaflet stand-in plus a record of everything drawn through it.
 *
 * @param {object} [options]
 * @param {boolean} [options.throwOnSecondMap] Mimic real Leaflet's refusal to
 *   initialise the same container twice.
 */
export function createLeafletStub({ throwOnSecondMap = false } = {}) {
  const record = {
    polygons: [],
    markers: [],
    circles: [],
    tileLayers: [],
    frontOrder: [],
    mapCreations: 0,
    invalidateSizeCalls: 0,
    clickHandlers: [],
    offCalls: 0,
    view: null,
  };

  const map = {
    setView(center, zoom) {
      record.view = { center, zoom };
      return this;
    },
    on(event, handler) {
      if (event === "click") record.clickHandlers.push(handler);
    },
    off() {
      record.offCalls++;
      record.clickHandlers.length = 0;
    },
    invalidateSize() {
      record.invalidateSizeCalls++;
    },
  };

  const L = {
    map() {
      record.mapCreations++;
      if (throwOnSecondMap && record.mapCreations > 1) {
        throw new Error("Map container is already initialized.");
      }
      return map;
    },
    tileLayer(url, options) {
      record.tileLayers.push({ url, options });
      return { addTo: () => {} };
    },
    polygon(vertices, style) {
      const polygon = new StubPolygon(vertices, style, record);
      record.polygons.push(polygon);
      return polygon;
    },
    marker(coords, options) {
      const marker = {
        coords,
        options,
        popup: null,
        handlers: {},
        addTo() {
          return this;
        },
        bindPopup(content) {
          this.popup = content;
        },
        on(event, handler) {
          this.handlers[event] = handler;
        },
        getPopup() {
          return {
            setContent: (content) => {
              marker.popup = content;
            },
          };
        },
      };
      record.markers.push(marker);
      return marker;
    },
    circle(coords, options) {
      record.circles.push({ coords, options });
      return { addTo: () => {} };
    },
    divIcon: (options) => ({ options }),
    latLng: (lat, lng) => ({ lat, lng }),
  };

  return { L, map, record };
}

/**
 * A frame scheduler that runs synchronously and jumps far enough forward that
 * every tween reaches t = 1 in a single step.
 *
 * This is what makes animation assertions possible at all: the real runner is
 * driven by requestAnimationFrame across 28 seconds of wall clock.
 */
export function createSyncScheduler(stepMs = 100000) {
  const queue = [];
  let now = 0;
  return {
    requestFrame: (cb) => queue.push(cb),
    schedule: (cb) => queue.push(() => cb()),
    /** Drain the queue, guarding against a runaway chain. */
    run(limit = 1000) {
      let iterations = 0;
      while (queue.length > 0) {
        if (++iterations > limit) throw new Error("scheduler did not settle");
        now += stepMs;
        queue.shift()(now);
      }
      return iterations;
    },
  };
}

/** A deterministic stand-in for Math.random that cycles through fixed values. */
export function sequenceRandom(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Load a data file the same way the browser would, but from disk. */
export async function loadData(name) {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(resolve(here, "../../public/data", name), "utf8"));
}
