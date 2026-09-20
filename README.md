# FlameSense

Wildfire spread visualisation, built at a Los Altos hackathon, where it placed
3rd.

FlameSense helps first responders and the public by simulating wildfire spread
using a sequential neural network trained on historical fire data and current
weather conditions such as temperature, humidity and wind. Users select a
location on a map to see predicted fire growth animated as an expanding heat
map, which supports better resource planning and public awareness.

**Live site:** https://fire-space-front-end-git-main-edison16as-projects.vercel.app/

---

## How it works

The landing page explains the project in five steps. The **Predict** view opens
a full-screen map of California and does three things:

- **Plots current wildfires.** Open wildfire events are pulled from NASA EONET
  and drawn as 🔥 markers, each with a red impact circle whose radius is derived
  from the event's reported burn area in acres.
- **Reports current conditions.** Clicking anywhere on the map fetches live
  weather for that point from Open-Meteo and shows it in an overlay, along with
  a computed "growth percentage" scoring how favourable conditions are to
  spread.
- **Animates the spread.** A ragged, twenty-sided polygon expands outward
  through four phases, shading from red through orange and yellow to green. The
  shape is biased downwind using the current wind bearing, and its starting size
  is scaled by the growth percentage.

Clicking an existing fire marker reverse-geocodes its location via Nominatim and
offers a **Simulate Fire** button, which runs the same animation seeded from that
fire's real reported size.

### How the project was built

1. **Data collection.** Current and historical wildfire and conditions data were
   gathered from sources including NASA FIRMS and Open-Meteo, covering humidity,
   temperature, dryness and biomass. Palantir's tools were used to clean and
   transform it.
2. **Training.** The cleaned data trained a model in Palantir taking humidity,
   temperature, dryness and biomass as inputs and producing a predicted fire
   radius.
3. **Exposing the function.** The model was converted into a TypeScript function
   and exposed so it could be called from JavaScript.
4. **Front end.** An HTML front end displays the map and animates predicted
   spread for a chosen location.

**Future plans:** expand the model and train it on more data for more accurate
predictions.

---

## Running it

The site is plain static files with no build step. Serve `public/` over HTTP —
opening `index.html` from the filesystem will not work, because ES modules and
`fetch` of the data files both require a real origin.

```bash
npm run serve      # http://localhost:8000
```

Any static server works; the npm script is just a convenience wrapper around
Python's built-in one.

Node is needed only for the tests and the data tooling, never to serve the site:

```bash
npm test           # run the test suite
npm run validate   # check every data file
npm run check      # both
```

---

## Architecture

The project was originally a single 1165-line `index.html` holding all markup,
two stylesheets and four script blocks. It is now layered, with each layer
depending only on the ones above it.

```
public/
  index.html            Skeleton only: empty mount points and script tags
  assets/               Screenshots used by the landing page
  styles/
    tokens.css          Colours, radii, durations as custom properties
    base.css            Reset and page defaults
    layout.css          Landing page: nav, hero, panels, footer
    map.css             Predict view: map, overlays, markers
  data/                 Everything editable without touching code (see below)
  src/
    main.js             Entry point; loads data and wires modules together
    core/
      config.js         Loads the data files
      color.js          Hex colour blending for the animation ramp
      geometry.js       Vertex ring construction, wind bias, projection
      growth.js         The growth-percentage heuristic and radius factor
    services/
      weather.js        Open-Meteo client
      eonet.js          NASA EONET wildfire events client
      geocode.js        Nominatim reverse geocoding
    map/
      map-controller.js Leaflet setup, markers, click handling
      fire-animation.js The table-driven animation runner
      polygon-store.js  The stack of polygons making up one fire
    ui/
      content.js        Renders the landing page from content.json
      navigation.js     Switching between the two views
      overlays.js       The two floating map readouts
tools/
  extract-data.mjs      Regenerates content.json and cities.json from history
  validate-data.mjs     Checks every data file, structurally and for fidelity
tests/                  Node test-runner suites
```

Two design rules hold throughout:

- **Nothing reaches for globals.** Leaflet, `fetch`, the frame scheduler, the
  DOM and `Math.random` are all passed in as arguments. That is what lets the
  logic be tested under Node with no browser, and it is why the page now exports
  no globals of its own at all.
- **Data is loaded, never hard-coded.** Modules receive plain configuration
  objects and do not know where they came from.

---

## Data files

Everything below lives in `public/data/` and is read at runtime. Changing any of
it requires no code change and no rebuild — edit the JSON, reload the page.

| File | What it controls |
| --- | --- |
| `content.json` | Every visitor-facing string: nav labels, hero copy and photo, the five explainer panels, overlay placeholders, footer, page title |
| `site.config.json` | API endpoints, map camera, tile layer, the weather readout rows, EONET filtering and marker styling, geocoding preferences |
| `growth-model.json` | Coefficients for the growth-percentage heuristic and the radius multiplier |
| `fire-phases.json` | The two animation sequences: durations, colours, scaling, offset growth, plus the shared wind-bias and projection constants |
| `cities.json` | A static California city risk table (see the note below) |

After editing any of them, run `npm run validate`.

> **Note on `cities.json`:** this data is currently inert. The loop that turned
> it into map markers was commented out in the original page, so nothing renders
> from it. It is preserved so the data is not lost and can be restored without
> being retyped.

### Adding a new explainer panel

Append an object to `steps` in `content.json`:

```json
{
  "id": "how6",
  "image": "assets/my-screenshot.png",
  "alt": "Short description for screen readers",
  "heading": "Step 5: What We Did Next",
  "body": "A paragraph explaining it."
}
```

Drop the image into `public/assets/`, run `npm run validate`, and reload. The
panel is rendered, revealed on scroll and hidden when the map view opens, with
no code change. `image` may also be an absolute `https://` URL.

### Adding a new nav item

Append to `nav.items` in `content.json`:

```json
{ "id": "researchNav", "label": "Research", "action": "home", "scrollTarget": "how6" }
```

`action` is either `"home"` (return to the landing page if the map is open,
otherwise smooth-scroll to `scrollTarget`) or `"map"` (open the Predict view).
`id` must be unique and `scrollTarget` must name a panel id or `hero` — the
validator checks both.

### Adding a weather reading to the overlay

Add the field to `weather.current` in `site.config.json` so it is requested,
then add a row to `weather.readout`:

```json
{ "key": "soil_moisture_0_to_1cm", "label": "Soil Moisture", "unit": "" }
```

The validator rejects a readout row whose key is never requested, since it would
always render `undefined`.

### Retuning the model or the animation

Edit `growth-model.json` and `fire-phases.json`. The validator enforces the
constraints the code relies on — consecutive animation phases must hand off
colour cleanly, every non-final phase must be able to chain to the next, and the
wind clamp must stay positive so vertices cannot invert through the centre.

### Regenerating the extracted content

`content.json` and `cities.json` were produced by parsing the original page
rather than being typed out, so that no coordinate or sentence could be
corrupted in transcription. To regenerate them:

```bash
npm run extract
```

The script reads the pre-refactor `index.html` from git history, so it is
idempotent. A test asserts that a fresh extraction still reproduces the
committed files byte for byte.

---

## Validation and tests

`npm run validate` runs two kinds of check:

- **Structural** — does each data file carry the fields the code reads, and stay
  self-consistent? Unique control ids, scroll targets that resolve, readout keys
  that are actually requested, well-formed `#rrggbb` colours, local images
  present on disk, executable phase tables.
- **Fidelity** — does the extracted content still match the pre-refactor page?
  This reads the original `index.html` out of git history, so it cannot be
  fooled by editing a working copy. City coordinates are matched verbatim, which
  is what rules out a transposed digit.

`npm test` covers the colour ramp, the geometry and wind bias, the growth model,
all three API clients, the animation runner and the map controller, with
Leaflet, the DOM, `fetch` and randomness stubbed. No network, no browser.

---

## Third-party services

All are keyless and called directly from the browser.

| Service | Used for |
| --- | --- |
| [Leaflet](https://leafletjs.com/) 1.9.4 | Map rendering, pinned via CDN |
| [OpenStreetMap](https://www.openstreetmap.org/) | Map tiles |
| [Open-Meteo](https://open-meteo.com/) | Current and hourly weather |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Open wildfire events |
| [Nominatim](https://nominatim.org/) | Reverse geocoding |

## Deployment

Vercel serves `public/` as the site root. There is no build step; a push
deploys the files as they are.
