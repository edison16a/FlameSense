import test from "node:test";
import assert from "node:assert/strict";
import { observeStepReveals, renderContent } from "../public/src/ui/content.js";
import { createObserverStub, createStubDocument } from "./helpers/dom-stub.mjs";
import { loadData } from "./helpers/leaflet-stub.mjs";

const content = await loadData("content.json");

/** Render the landing page into a fresh stub document. */
function render(data = content) {
  const doc = createStubDocument();
  const result = renderContent(data, doc);
  return { doc, ...result };
}

test("the document title comes from the content data", () => {
  const { doc } = render();
  assert.equal(doc.title, content.document.title);
});

test("one panel is rendered per step, in order", () => {
  const { doc, steps } = render();
  assert.equal(steps.length, content.steps.length);
  assert.deepEqual(steps.map((s) => s.id), content.steps.map((s) => s.id));
  // Panels are inserted before the map section, not into a wrapper, so the DOM
  // keeps the shape the stylesheet was written against.
  assert.deepEqual(doc.body.children, steps);
});

test("each panel carries the classes the stylesheet targets", () => {
  const { steps } = render();
  for (const panel of steps) {
    assert.equal(panel.className, "section container");
    assert.ok(panel.find("image"), "panel needs an .image wrapper");
    assert.ok(panel.find("text"), "panel needs a .text wrapper");
  }
});

test("panel image, heading and body come through intact", () => {
  const { steps } = render();
  content.steps.forEach((step, i) => {
    const img = steps[i].find("image").children[0];
    assert.equal(img.src, step.image);
    assert.equal(img.alt, step.alt);
    const text = steps[i].find("text");
    assert.equal(text.children[0].textContent, step.heading);
    assert.equal(text.children[1].textContent, step.body);
  });
});

test("the hero heading keeps the flame in its own animated span", () => {
  // The span carries the flicker animation, so it has to survive rendering,
  // and the content file must not need to contain markup to produce it.
  const { doc } = render();
  const heading = doc.getElementById("hero").children[0].children[0];
  const flame = heading.find("fire-emoji");
  assert.ok(flame, "the flame span is missing");
  assert.equal(flame.textContent, content.hero.flame);
  assert.equal(
    heading.textContent,
    `${content.hero.headingBefore} ${content.hero.flame} ${content.hero.headingAfter}`,
  );
});

test("the hero photograph is applied as a custom property", () => {
  const { doc } = render();
  assert.equal(
    doc.getElementById("hero").style.properties["--hero-background-image"],
    `url('${content.hero.backgroundImage}')`,
  );
});

test("nav renders the logo and one button per item", () => {
  const { doc } = render();
  const nav = doc.querySelector("nav");
  const logo = nav.find("nav-logo");
  assert.equal(logo.id, content.nav.logo.id);
  assert.equal(logo.textContent, content.nav.logo.label);

  const buttons = nav.findAll("nav-button");
  assert.deepEqual(buttons.map((b) => b.id), content.nav.items.map((i) => i.id));
  assert.deepEqual(buttons.map((b) => b.textContent), content.nav.items.map((i) => i.label));
});

test("overlay placeholders and the footer are filled from data", () => {
  const { doc } = render();
  for (const [id, text] of Object.entries(content.mapOverlays)) {
    assert.equal(doc.getElementById(id).textContent, text);
  }
  assert.equal(doc.querySelector("footer").textContent, content.footer);
});

test("content is set as text, so a data file cannot inject markup", () => {
  // Everything here is authored data rather than user input, but the renderer
  // still must not be a path from a JSON edit to executing script.
  const hostile = structuredClone(content);
  hostile.steps[0].heading = "<img src=x onerror=alert(1)>";
  hostile.footer = "<script>alert(2)</script>";

  const { doc, steps } = render(hostile);
  const heading = steps[0].find("text").children[0];
  assert.equal(heading.textContent, "<img src=x onerror=alert(1)>");
  assert.ok(heading.html.includes("&lt;img"), "must be escaped");
  assert.equal(heading.children.length, 0, "no element may be created");
  assert.ok(doc.querySelector("footer").html.includes("&lt;script"));
});

test("adding a panel to the data renders it, with no code change", () => {
  const extended = structuredClone(content);
  extended.steps.push({
    id: "how6",
    image: "assets/data.png",
    alt: "Alt text",
    heading: "Step 5: What We Did Next",
    body: "A paragraph.",
  });
  const { steps } = render(extended);
  assert.equal(steps.length, content.steps.length + 1);
  assert.equal(steps.at(-1).id, "how6");
  assert.equal(steps.at(-1).find("text").children[0].textContent, "Step 5: What We Did Next");
});

test("the reveal observer watches every panel and adds the visible class", () => {
  // Load-bearing rather than decorative: .section starts at opacity 0, so an
  // unobserved panel never appears at all.
  const { Stub, observed } = createObserverStub();
  const previous = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = Stub;
  try {
    const { steps } = render();
    observeStepReveals(steps);
    assert.deepEqual(observed, steps);
    assert.equal(Stub.instances[0].options.threshold, 0.2);

    const panel = steps[0];
    let classes = "";
    panel.classList = { add: (c) => (classes = c) };
    Stub.instances[0].reveal([panel]);
    assert.equal(classes, "visible");
  } finally {
    globalThis.IntersectionObserver = previous;
  }
});
