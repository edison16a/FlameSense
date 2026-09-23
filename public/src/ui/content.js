/**
 * Renders the landing page from `data/content.json`.
 *
 * WHY render rather than ship static markup: every string and every panel was
 * previously written into index.html, so adding a sixth "How We Did It" step
 * meant copying a 15-line <section> block and getting its class names right.
 * Building the panels from data makes that a JSON edit.
 *
 * Text is set with textContent throughout, never innerHTML, so a content file
 * can add copy but cannot inject markup or script into the page.
 */

/**
 * Build one "How We Did It" panel.
 *
 * The structure mirrors the original markup exactly (section.section.container
 * wrapping .image and .text) because layout.css targets those class names and
 * the IntersectionObserver reveal keys off `.section`.
 *
 * @param {{ id: string, image: string, alt: string, heading: string, body: string }} step
 * @returns {HTMLElement}
 */
function renderStep(step) {
  const section = document.createElement("section");
  section.className = "section container";
  section.id = step.id;

  const imageWrap = document.createElement("div");
  imageWrap.className = "image";
  const img = document.createElement("img");
  img.src = step.image;
  img.alt = step.alt;
  imageWrap.append(img);

  const textWrap = document.createElement("div");
  textWrap.className = "text";
  const heading = document.createElement("h2");
  heading.textContent = step.heading;
  const body = document.createElement("p");
  body.textContent = step.body;
  textWrap.append(heading, body);

  section.append(imageWrap, textWrap);
  return section;
}

/** Populate the fixed navigation bar. */
function renderNav(nav, content) {
  const logo = document.createElement("div");
  logo.className = "nav-logo";
  logo.id = content.nav.logo.id;
  logo.textContent = content.nav.logo.label;

  const list = document.createElement("ul");
  for (const item of content.nav.items) {
    const li = document.createElement("li");
    const button = document.createElement("div");
    button.className = "nav-button";
    button.id = item.id;
    button.textContent = item.label;
    li.append(button);
    list.append(li);
  }

  nav.replaceChildren(logo, list);
}

/**
 * Populate the hero banner.
 *
 * The heading is assembled from three content fields so the flickering flame
 * keeps its own <span> (that span carries the CSS animation) without the
 * content file needing to contain markup. Spaces are re-inserted between the
 * pieces because the extractor stores each part trimmed.
 */
function renderHero(hero, content) {
  hero.style.setProperty("--hero-background-image", `url('${content.hero.backgroundImage}')`);

  const heading = document.createElement("h1");
  const flame = document.createElement("span");
  flame.className = "fire-emoji";
  flame.textContent = content.hero.flame;
  heading.append(
    `${content.hero.headingBefore} `,
    flame,
    ` ${content.hero.headingAfter}`,
  );

  const tagline = document.createElement("p");
  tagline.textContent = content.hero.tagline;

  const cta = document.createElement("button");
  cta.className = "btn";
  cta.id = content.hero.ctaId;
  cta.textContent = content.hero.ctaLabel;

  const wrapper = document.createElement("div");
  wrapper.className = "content";
  wrapper.append(heading, tagline, cta);
  hero.replaceChildren(wrapper);
}

/**
 * Render the whole landing page into the document skeleton.
 *
 * Panels are inserted directly before the map section rather than into a
 * wrapper element, so the resulting DOM has the same shape as the hand-written
 * markup it replaces and the stylesheet's assumptions still hold.
 *
 * @param {object} content Parsed `data/content.json`.
 * @param {Document} [doc]
 * @returns {{ steps: HTMLElement[] }} The rendered panels, for the navigation
 *   module to show and hide and the observer to watch.
 */
export function renderContent(content, doc = document) {
  doc.title = content.document.title;
  renderNav(doc.querySelector("nav"), content);
  renderHero(doc.getElementById("hero"), content);

  const mapSection = doc.getElementById("map-demo");
  const steps = content.steps.map(renderStep);
  for (const step of steps) {
    mapSection.parentNode.insertBefore(step, mapSection);
  }

  for (const [id, text] of Object.entries(content.mapOverlays)) {
    doc.getElementById(id).textContent = text;
  }
  doc.querySelector("footer").textContent = content.footer;

  return { steps };
}

/**
 * Reveal panels as they scroll into view.
 *
 * Load-bearing rather than decorative: `.section` starts at opacity 0, so a
 * panel that is never observed never becomes visible. The 0.2 threshold means a
 * panel fades in once a fifth of it has entered the viewport.
 *
 * @param {HTMLElement[]} steps
 */
export function observeStepReveals(steps) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add("visible");
      }
    },
    { threshold: 0.2 },
  );
  for (const step of steps) observer.observe(step);
}
