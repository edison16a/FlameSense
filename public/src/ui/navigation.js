/**
 * Switching between the landing page and the map view.
 *
 * The app has exactly two views and no router: it toggles `display` on the
 * landing-page elements and on the map section. That is kept as is. This module
 * just gives the toggle one home and drives it from the content data rather
 * than from a hard-coded list of five element ids.
 */

/**
 * Wire up the navigation controls.
 *
 * @param {object} deps
 * @param {object} deps.content Parsed `data/content.json`.
 * @param {HTMLElement[]} deps.steps Rendered content panels.
 * @param {() => void} deps.onEnterMap Called when the map view opens. This is
 *   where the map gets created, which is why it is a callback rather than an
 *   import: navigation must not depend on Leaflet.
 * @param {Document} [deps.doc]
 */
export function setupNavigation({ content, steps, onEnterMap, doc = document }) {
  /** True while the map view is showing. Drives what the 'home' action does. */
  let demoMode = false;

  const hero = doc.getElementById("hero");
  const mapSection = doc.getElementById("map-demo");

  function showMainPage() {
    demoMode = false;
    // Explicitly 'flex', not '', because the hero and the panels are flex
    // containers and the stylesheet relies on it.
    hero.style.display = "flex";
    for (const step of steps) step.style.display = "flex";
    mapSection.style.display = "none";
  }

  function showMapDemo() {
    demoMode = true;
    hero.style.display = "none";
    for (const step of steps) step.style.display = "none";
    mapSection.style.display = "block";
    onEnterMap();
  }

  /**
   * Run a control's configured action.
   *
   * 'home' deliberately does not scroll when leaving the map view: it only
   * restores the landing page, leaving the reader wherever they were. That
   * asymmetry is how the original behaved.
   *
   * @param {{ action: string, scrollTarget?: string }} config
   */
  function handle(config) {
    if (config.action === "map") {
      showMapDemo();
      return;
    }
    if (demoMode) {
      showMainPage();
      return;
    }
    doc.getElementById(config.scrollTarget).scrollIntoView({ behavior: "smooth" });
  }

  const controls = [content.nav.logo, ...content.nav.items, content.hero];
  for (const control of controls) {
    const id = control.id ?? control.ctaId;
    doc.getElementById(id).addEventListener("click", () => handle(control));
  }

  return { showMainPage, showMapDemo };
}
