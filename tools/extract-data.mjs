#!/usr/bin/env node
/**
 * One-shot extractor that lifts the hard-coded content out of the original
 * monolithic `public/index.html` and writes it to `public/data/*.json`.
 *
 * WHY this exists rather than hand-copying the values: the monolith contained
 * ten city records, five prose sections and a pile of nav/hero/footer strings.
 * Retyping that volume by hand is exactly the kind of work that introduces
 * silent, invisible-in-review errors (a dropped decimal in a latitude, a
 * swapped word in a paragraph). Parsing the source guarantees the JSON is
 * byte-faithful to what the page actually shipped.
 *
 * It is kept in the repository (rather than deleted after use) so the
 * extraction is reproducible and auditable against the git history: point it
 * at the pre-refactor revision of index.html and it regenerates the same data.
 *
 * Usage:
 *   node tools/extract-data.mjs [path/to/index.html] [--out public/data]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * Collapse HTML source whitespace the way a browser's inline formatting
 * context does: runs of spaces/newlines/tabs become a single space, and the
 * result is trimmed. The monolith hard-wrapped its prose at ~80 columns with
 * six-space indentation, none of which is rendered. Normalising here means the
 * JSON holds the sentence a visitor actually reads.
 */
function collapseWhitespace(html) {
  return html.replace(/\s+/g, " ").trim();
}

/**
 * Decode the handful of named entities the source uses. The extractor stores
 * plain text in JSON and the renderer re-escapes on output, so keeping raw
 * entities here would double-encode them ("&amp;copy;").
 */
function decodeEntities(text) {
  const named = { "&copy;": "©", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  return text.replace(/&(?:copy|amp|lt|gt|quot|#39);/g, (m) => named[m]);
}

/** Pull the first capture group of `re` out of `source`, or fail loudly. */
function requireMatch(source, re, what) {
  const m = source.match(re);
  if (!m) throw new Error(`extract: could not locate ${what}`);
  return m;
}

/**
 * Extract the five "How We Did It" panels.
 *
 * Each is a <section class="section container" id="..."> holding an image and
 * a heading/paragraph pair. They are uniform enough to parse structurally,
 * which also means a sixth panel added to the JSON later needs no new code.
 */
function extractSteps(html) {
  const sectionRe =
    /<section class="section container" id="([^"]+)">([\s\S]*?)<\/section>/g;
  const steps = [];
  for (const [, id, body] of html.matchAll(sectionRe)) {
    const src = requireMatch(body, /<img[^>]*\ssrc="([^"]+)"/, `image src in #${id}`)[1];
    const alt = requireMatch(body, /<img[^>]*\salt="([^"]*)"/, `image alt in #${id}`)[1];
    const heading = requireMatch(body, /<h2>([\s\S]*?)<\/h2>/, `heading in #${id}`)[1];
    const text = requireMatch(body, /<p>([\s\S]*?)<\/p>/, `paragraph in #${id}`)[1];
    steps.push({
      id,
      image: src,
      alt: decodeEntities(collapseWhitespace(alt)),
      heading: decodeEntities(collapseWhitespace(heading)),
      body: decodeEntities(collapseWhitespace(text)),
    });
  }
  if (steps.length === 0) throw new Error("extract: found no content sections");
  return steps;
}

/**
 * What each nav control does, keyed by the element id the original used.
 *
 * WHY a table rather than parsing: in the source each control's behaviour lived
 * in its own addEventListener block of imperative statements. There is no
 * reliable general parse of "what does this handler do", so the behaviour is
 * transcribed once here -- it is five short entries, not bulk data -- and
 * emitted into the content file so that adding a nav entry later is a data edit.
 *
 * "home" means: if the map view is open, return to the landing page; otherwise
 * smooth-scroll to `scrollTarget`. All three landing-page controls shared that
 * shape in the original, differing only in where they scrolled.
 */
const NAV_ACTIONS = {
  homeBtn: { action: "home", scrollTarget: "hero" },
  aboutNav: { action: "home", scrollTarget: "hero" },
  howNav: { action: "home", scrollTarget: "how" },
  demoNav: { action: "map" },
  demoBtn: { action: "map" },
};

/** Look up a control's behaviour, failing loudly on an unrecognised id. */
function actionFor(id) {
  const action = NAV_ACTIONS[id];
  if (!action) throw new Error(`extract: no known behaviour for control #${id}`);
  return action;
}

/** Extract the fixed navigation bar: the logo plus its three buttons. */
function extractNav(html) {
  const nav = requireMatch(html, /<nav>([\s\S]*?)<\/nav>/, "nav element")[1];
  const logoRaw = requireMatch(
    nav,
    /<div class="nav-logo" id="([^"]+)">([\s\S]*?)<\/div>/,
    "nav logo",
  );
  const items = [];
  for (const [, id, label] of nav.matchAll(
    /<div class="nav-button" id="([^"]+)">([\s\S]*?)<\/div>/g,
  )) {
    items.push({ id, label: decodeEntities(collapseWhitespace(label)), ...actionFor(id) });
  }
  return {
    logo: {
      id: logoRaw[1],
      label: decodeEntities(collapseWhitespace(logoRaw[2])),
      ...actionFor(logoRaw[1]),
    },
    items,
  };
}

/**
 * Extract the hero banner.
 *
 * The <h1> interleaves text with a <span class="fire-emoji"> that carries the
 * flicker animation, so it is stored as three pieces rather than one string:
 * the renderer must be able to rebuild that span, and storing raw HTML in a
 * content file would mean the content file could inject markup.
 */
function extractHero(html) {
  const hero = requireMatch(html, /<header class="hero" id="hero">([\s\S]*?)<\/header>/, "hero")[1];
  const h1 = requireMatch(hero, /<h1>([\s\S]*?)<\/h1>/, "hero heading")[1];
  const emoji = requireMatch(h1, /<span class="fire-emoji">([\s\S]*?)<\/span>/, "hero flame span")[1];
  const [before, after] = h1.split(/<span class="fire-emoji">[\s\S]*?<\/span>/);
  return {
    headingBefore: decodeEntities(collapseWhitespace(before)),
    flame: collapseWhitespace(emoji),
    headingAfter: decodeEntities(collapseWhitespace(after)),
    tagline: decodeEntities(collapseWhitespace(requireMatch(hero, /<p>([\s\S]*?)<\/p>/, "hero tagline")[1])),
    // The hero photograph is referenced from CSS (`.hero { background: url(...) }`)
    // rather than from markup, which meant a piece of visible content was only
    // changeable by editing a stylesheet. Lift it out so it lives with the rest
    // of the copy; the renderer feeds it back in through a custom property.
    backgroundImage: requireMatch(html, /\.hero\s*\{[\s\S]*?background:\s*url\('([^']+)'\)/, "hero background image")[1],
    ctaId: requireMatch(hero, /<button class="btn" id="([^"]+)">/, "hero CTA id")[1],
    ...actionFor(requireMatch(hero, /<button class="btn" id="([^"]+)">/, "hero CTA id")[1]),
    ctaLabel: decodeEntities(
      collapseWhitespace(requireMatch(hero, /<button class="btn" id="[^"]+">([\s\S]*?)<\/button>/, "hero CTA label")[1]),
    ),
  };
}

/** Extract the two map overlays' placeholder copy and the footer line. */
function extractChrome(html) {
  const overlays = {};
  for (const [, id, text] of html.matchAll(
    /<div class="fire-overlay" id="([^"]+)">([\s\S]*?)<\/div>/g,
  )) {
    overlays[id] = decodeEntities(collapseWhitespace(text));
  }
  const footer = decodeEntities(
    collapseWhitespace(requireMatch(html, /<footer>([\s\S]*?)<\/footer>/, "footer")[1]),
  );
  const title = decodeEntities(
    collapseWhitespace(requireMatch(html, /<title>([\s\S]*?)<\/title>/, "document title")[1]),
  );
  return { overlays, footer, title };
}

/**
 * Extract the static California city risk table.
 *
 * The array is a plain JS literal, so it is evaluated in a locked-down VM
 * context instead of being pattern-matched field by field. Evaluating the real
 * literal is what makes the ten records provably identical to the originals;
 * a regex over `name`/`coords`/`risk` would be one typo away from silently
 * relocating a city.
 */
function extractCities(html) {
  const literal = requireMatch(html, /const cities = (\[[\s\S]*?\n {6}\]);/, "cities array")[1];
  const cities = vm.runInNewContext(`(${literal})`, Object.create(null), {
    timeout: 1000,
  });
  if (!Array.isArray(cities) || cities.length === 0) {
    throw new Error("extract: cities literal did not evaluate to a non-empty array");
  }
  return cities.map(({ name, coords, risk }) => ({ name, coords, risk }));
}

function main() {
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outDir = resolve(REPO_ROOT, outFlag === -1 ? "public/data" : args[outFlag + 1]);
  const inputArg = args.find((a, i) => !a.startsWith("--") && (outFlag === -1 || i !== outFlag + 1));
  const input = resolve(REPO_ROOT, inputArg ?? "public/index.html");

  const html = readFileSync(input, "utf8");
  const { overlays, footer, title } = extractChrome(html);

  const content = {
    document: { title },
    nav: extractNav(html),
    hero: extractHero(html),
    steps: extractSteps(html),
    mapOverlays: overlays,
    footer,
  };

  const cities = {
    description:
      "Static California city fire-risk reference data carried over from the original page.",
    cities: extractCities(html),
  };

  mkdirSync(outDir, { recursive: true });
  const write = (name, value) =>
    writeFileSync(resolve(outDir, name), JSON.stringify(value, null, 2) + "\n");

  write("content.json", content);
  write("cities.json", cities);

  console.log(`extracted ${content.steps.length} content sections, ` +
    `${content.nav.items.length} nav items, ${cities.cities.length} cities`);
  console.log(`wrote ${resolve(outDir, "content.json")}`);
  console.log(`wrote ${resolve(outDir, "cities.json")}`);
}

main();
