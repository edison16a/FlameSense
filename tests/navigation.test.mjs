import test from "node:test";
import assert from "node:assert/strict";
import { setupNavigation } from "../public/src/ui/navigation.js";
import { createStubDocument } from "./helpers/dom-stub.mjs";
import { loadData } from "./helpers/leaflet-stub.mjs";

const content = await loadData("content.json");

/**
 * Wire up navigation over a stub document with fake content panels.
 *
 * Panels are supplied directly rather than rendered, so these tests cover the
 * view switching on its own.
 */
function harness() {
  const doc = createStubDocument();
  for (const control of [content.nav.logo, ...content.nav.items]) doc.getElementById(control.id);
  doc.getElementById(content.hero.ctaId);

  const steps = content.steps.map((step) =>
    Object.assign(doc.getElementById(step.id), { id: step.id }),
  );

  let enterMapCalls = 0;
  const api = setupNavigation({
    content,
    steps,
    onEnterMap: () => enterMapCalls++,
    doc,
  });
  return { doc, steps, api, enterMapCalls: () => enterMapCalls };
}

const displayOf = (doc, id) => doc.getElementById(id).style.display;

test("every control in the content data gets a listener", () => {
  const { doc } = harness();
  const ids = [content.nav.logo.id, ...content.nav.items.map((i) => i.id), content.hero.ctaId];
  for (const id of ids) {
    assert.equal(typeof doc.getElementById(id).listeners.click, "function", `#${id} unwired`);
  }
});

test("opening the map hides the hero and every panel", () => {
  const { doc, steps, enterMapCalls } = harness();
  doc.getElementById("demoNav").click();

  assert.equal(displayOf(doc, "hero"), "none");
  assert.equal(displayOf(doc, "map-demo"), "block");
  for (const step of steps) assert.equal(step.style.display, "none");
  assert.equal(enterMapCalls(), 1, "the map must be told to initialise");
});

test("the hero button opens the map too", () => {
  const { doc, enterMapCalls } = harness();
  doc.getElementById(content.hero.ctaId).click();
  assert.equal(displayOf(doc, "map-demo"), "block");
  assert.equal(enterMapCalls(), 1);
});

test("returning from the map restores the hero and panels as flex", () => {
  // Explicitly flex, not cleared: the hero and the panels are flex containers
  // and the stylesheet depends on that.
  const { doc, steps } = harness();
  doc.getElementById("demoNav").click();
  doc.getElementById("aboutNav").click();

  assert.equal(displayOf(doc, "hero"), "flex");
  assert.equal(displayOf(doc, "map-demo"), "none");
  for (const step of steps) assert.equal(step.style.display, "flex");
});

test("a home control scrolls when already on the landing page", () => {
  const { doc } = harness();
  doc.getElementById("howNav").click();
  assert.deepEqual(doc.scrollCalls, [{ id: "how", options: { behavior: "smooth" } }]);
});

test("the logo and About scroll to the hero, How We Did It scrolls to the panels", () => {
  const { doc } = harness();
  doc.getElementById("homeBtn").click();
  doc.getElementById("aboutNav").click();
  doc.getElementById("howNav").click();
  assert.deepEqual(doc.scrollCalls.map((c) => c.id), ["hero", "hero", "how"]);
});

test("a home control closes the map instead of scrolling", () => {
  // The asymmetry is deliberate and matches the original: leaving the map view
  // restores the landing page and leaves the reader where they were.
  const { doc } = harness();
  doc.getElementById("demoNav").click();
  doc.getElementById("howNav").click();

  assert.equal(displayOf(doc, "hero"), "flex");
  assert.deepEqual(doc.scrollCalls, [], "closing the map must not scroll");
});

test("reopening the map calls onEnterMap again", () => {
  // The controller guards against building a second Leaflet map, but
  // navigation must keep announcing entry so the size can be refreshed.
  const { doc, enterMapCalls } = harness();
  doc.getElementById("demoNav").click();
  doc.getElementById("aboutNav").click();
  doc.getElementById("demoNav").click();
  assert.equal(enterMapCalls(), 2);
});

test("the returned api drives the same transitions as the controls", () => {
  const { doc, api } = harness();
  api.showMapDemo();
  assert.equal(displayOf(doc, "map-demo"), "block");
  api.showMainPage();
  assert.equal(displayOf(doc, "map-demo"), "none");
  assert.equal(displayOf(doc, "hero"), "flex");
});

test("panels added to the content data are switched too, with no code change", () => {
  // The point of driving this from data: a sixth panel must hide and show with
  // the rest without navigation.js learning its id.
  const doc = createStubDocument();
  for (const c of [content.nav.logo, ...content.nav.items]) doc.getElementById(c.id);
  doc.getElementById(content.hero.ctaId);
  const extended = { ...content, steps: [...content.steps, { id: "how6" }] };
  const steps = extended.steps.map((s) => Object.assign(doc.getElementById(s.id), { id: s.id }));

  setupNavigation({ content: extended, steps, onEnterMap: () => {}, doc });
  doc.getElementById("demoNav").click();
  assert.equal(doc.getElementById("how6").style.display, "none");
});
