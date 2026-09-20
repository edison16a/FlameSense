/**
 * Application entry point.
 *
 * Its whole job is composition: load the data files, render the page, then hand
 * each module the configuration and collaborators it needs. No behaviour lives
 * here, which is what keeps every other module importable and testable in
 * isolation.
 */

import { loadAppData } from "./core/config.js";
import { createGrowthModel } from "./core/growth.js";
import { createMapController } from "./map/map-controller.js";
import { observeStepReveals, renderContent } from "./ui/content.js";
import { setupNavigation } from "./ui/navigation.js";
import { createOverlays } from "./ui/overlays.js";

async function start() {
  const data = await loadAppData();

  const { steps } = renderContent(data.content);
  observeStepReveals(steps);

  const growth = createGrowthModel(data.growth);
  const overlays = createOverlays(data.site.weather);
  const controller = createMapController({
    L: window.L,
    config: data.site,
    phases: data.phases,
    growth,
    overlays,
  });

  /*
   * EONET popups are Leaflet-rendered HTML strings containing an inline
   * onclick, so the handler has to be reachable as a global. This is the single
   * deliberate export onto window; everything else stays module-scoped.
   */
  window.simulateExistingFireAt = controller.simulateExistingFireAt;

  setupNavigation({
    content: data.content,
    steps,
    onEnterMap: () => controller.init(),
  });
}

start().catch((error) => {
  console.error("FlameSense failed to start:", error);
});
