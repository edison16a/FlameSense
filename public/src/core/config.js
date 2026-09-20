/**
 * Loading of the runtime data files.
 *
 * WHY a loader at all: every list, string, colour and coefficient the app uses
 * now lives under `public/data/`. Fetching them in one place means modules
 * receive plain configuration objects as arguments and stay ignorant of where
 * the data came from -- which is what lets them be imported and tested under
 * Node, where `fetch` of a relative path would not work.
 */

/** Paths are relative to the document, i.e. to `public/`. */
const DATA_FILES = {
  content: "data/content.json",
  site: "data/site.config.json",
  growth: "data/growth-model.json",
  phases: "data/fire-phases.json",
};

/**
 * The full set of loaded data files.
 * @typedef {object} AppData
 * @property {object} content Visitor-facing copy.
 * @property {object} site Endpoints, map camera, marker styling.
 * @property {object} growth Growth-model coefficients.
 * @property {object} phases Animation phase tables and shape geometry.
 */

/**
 * Fetch one JSON data file, failing loudly rather than silently degrading.
 *
 * A missing or malformed data file is a deployment error, not a runtime
 * condition worth recovering from: with no content there is no page to show.
 * Throwing here surfaces it in the console instead of leaving a blank screen
 * with no explanation.
 *
 * @param {string} path
 * @returns {Promise<object>}
 */
async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load data file ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Load every data file in parallel.
 *
 * Parallel rather than sequential because none of them depends on another, and
 * the map view cannot render until all four are present anyway.
 *
 * @returns {Promise<AppData>}
 */
export async function loadAppData() {
  const entries = Object.entries(DATA_FILES);
  const loaded = await Promise.all(entries.map(([, path]) => loadJson(path)));
  return Object.fromEntries(entries.map(([key], i) => [key, loaded[i]]));
}
