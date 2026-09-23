# FlameSense

**3rd Place, Los Altos hackathon.**

At Los Altos, we built FlameSense, which helps first responders and the public
by simulating wildfire spread using a sequential neural network trained on
historical fire data and current weather conditions like temperature, humidity,
and wind. Users can select locations on a map to see predicted fire growth
visualized as a heat map, helping with better resource planning and awareness.

Live site: https://fire-space-front-end-git-main-edison16as-projects.vercel.app/

## What it does

The landing page explains the project. The Predict view opens a map of
California and does three things:

- Plots currently burning wildfires from NASA EONET as fire markers, each with a
  red circle sized from the event's reported burn area.
- Fetches live weather for wherever you click, shows it in an overlay, and
  scores how favorable conditions are for spread.
- Animates the spread as a ragged 20 sided polygon expanding through four
  phases, shading red to orange to yellow to green. The shape leans downwind,
  and its starting size scales with the growth score.

Clicking a fire marker looks up its location name and offers a Simulate Fire
button, which runs the same animation starting from that fire's real size.

## How we built it

### Step 1: Data Collection

![Data Collection](public/assets/data.png)

We gathered current and historical wildfire and conditions data from various
sources such as NASA FIRMS and Open Meteo. We collected factors such as
humidity, temperature, dryness, and biomass. We then used Palantir's tools to
clean and transform the data.

### Step 2: Training

We then used the cleaned data to train a model in Palantir which would take in
current data inputs such as humidity, temperature, dryness, and biomass and
outputs a predicted fire radius.

### Step 3: Exposing Function

![Data Integration](public/assets/expose.png)

We then converted the model into a TypeScript function. Then we exposed the
function to be called through JavaScript.

### Step 4: FrontEnd

![Model Training](public/assets/frontend.png)

We built a front end in HTML which displays a map and animates how the fire will
spread depending on a location.

### Future Plans

We plan to expand our model and train it with more data to make a more accurate
prediction.

## Running it

Static files, no build step. Serve `public/` over HTTP. Opening `index.html`
straight from disk will not work, because ES modules and the data files both
need a real origin.

```bash
npm run serve      # http://localhost:8000
```

Any static server works. Node is only needed for the tests and tooling, never to
serve the site:

```bash
npm test           # run the tests
npm run validate   # check the data files
npm run check      # both
```

## Architecture

The site started as one 1165 line `index.html` holding all the markup, two
stylesheets and four script blocks. It is now layered.

```
public/
  index.html            Skeleton only: empty mount points and script tags
  assets/               Screenshots for the landing page
  styles/
    tokens.css          Colors, radii, durations as custom properties
    base.css            Reset and page defaults
    layout.css          Landing page: nav, hero, panels, footer
    map.css             Predict view: map, overlays, markers
  data/                 Everything editable without touching code
  src/
    main.js             Entry point, loads data and wires modules together
    core/
      config.js         Loads the data files
      color.js          Hex color blending for the animation ramp
      geometry.js       Vertex rings, wind bias, projection
      growth.js         Growth score and radius multiplier
    services/
      weather.js        Open-Meteo client
      eonet.js          NASA EONET wildfire events client
      geocode.js        Nominatim reverse geocoding
    map/
      map-controller.js Leaflet setup, markers, click handling
      fire-animation.js The animation runner
      polygon-store.js  The stack of polygons making up one fire
    ui/
      content.js        Renders the landing page from content.json
      navigation.js     Switching between the two views
      overlays.js       The two floating map readouts
tools/
  extract-data.mjs      Regenerates content.json and cities.json
  validate-data.mjs     Checks the data files
tests/                  Node test runner suites
```

Modules never reach for globals. Leaflet, `fetch`, the frame scheduler, the DOM
and `Math.random` are all passed in as arguments, which is what lets the logic
run under Node with no browser. The page exports no globals of its own.

## Data files

These live in `public/data/` and are read at runtime. Changing any of them needs
no code change and no rebuild. Edit the JSON and reload.

| File | What it controls |
| --- | --- |
| `content.json` | Every visible string: nav labels, hero copy and photo, the panels, overlay placeholders, the map readout labels, footer, page title |
| `site.config.json` | API endpoints, map camera, tile layer, weather readout rows, EONET filtering, marker styling, geocoding |
| `growth-model.json` | Coefficients for the growth score and the radius multiplier |
| `fire-phases.json` | The two animation sequences, plus the wind bias and projection constants |
| `cities.json` | A static California city risk table |

Run `npm run validate` after editing any of them.

Note on `cities.json`: this data is currently unused. The loop that turned it
into map markers was commented out in the original page, so nothing renders from
it. It is kept so the data is not lost.

### Add a panel

Append to `steps` in `content.json`:

```json
{
  "id": "how6",
  "image": "assets/my-screenshot.png",
  "alt": "Short description for screen readers",
  "heading": "Step 5: What We Did Next",
  "body": "A paragraph explaining it."
}
```

Put the image in `public/assets/`, run `npm run validate`, reload. The panel
renders, fades in on scroll and hides with the rest when the map opens. `image`
can also be an absolute `https://` URL.

### Add a nav item

Append to `nav.items` in `content.json`:

```json
{ "id": "researchNav", "label": "Research", "action": "home", "scrollTarget": "how6" }
```

`action` is either `home` (go back to the landing page if the map is open,
otherwise scroll to `scrollTarget`) or `map` (open the Predict view). `id` must
be unique and `scrollTarget` must name a panel id or `hero`. The validator
checks both.

### Add a weather reading

Add the field to `weather.current` in `site.config.json` so it gets requested,
then add a row to `weather.readout`:

```json
{ "key": "soil_moisture_0_to_1cm", "label": "Soil Moisture", "unit": "" }
```

The validator rejects a readout row whose key is never requested, since it would
always render `undefined`.

### Reword the map overlays

The overlay heading, the growth label and the popup Location prefix live in
`content.json` under `runtime`. The heading keeps its placeholders inline:

```json
"weatherHeading": "Current Data at Latitude {lat}, Longitude {lng}:"
```

`{lat}` and `{lng}` are filled in at render time. Both have to stay present, and
the validator fails the run if either is dropped or misspelled.

### Retune the model or animation

Edit `growth-model.json` and `fire-phases.json`. The validator enforces what the
code relies on: consecutive animation phases have to hand off color cleanly,
every non final phase has to chain to the next, and the wind clamp has to stay
positive so vertices cannot invert through the center.

### Regenerate extracted content

`content.json` and `cities.json` were produced by parsing the original page
rather than being typed out, so no coordinate or sentence could be corrupted
along the way. To regenerate:

```bash
npm run extract
```

It reads the pre refactor `index.html` from git history, so it is idempotent. A
test checks that a fresh extraction still matches the committed files exactly.

## Tests

`npm test` covers the color ramp, geometry and wind bias, the growth model, the
three API clients, the animation runner, the map controller, the landing page
renderer, view switching, the overlays and the data loader. Leaflet, the DOM,
`fetch` and randomness are stubbed, so it needs no network and no browser.

`npm run validate` checks the data files two ways. Structurally: unique ids,
scroll targets that resolve, readout keys that get requested, valid colors,
images present on disk, usable phase tables. And for fidelity, by comparing the
extracted content against the original `index.html` in git history, so nothing
can be quietly reworded or dropped.

## Services

All keyless, all called straight from the browser.

| Service | Used for |
| --- | --- |
| [Leaflet](https://leafletjs.com/) 1.9.4 | Map rendering, pinned via CDN |
| [OpenStreetMap](https://www.openstreetmap.org/) | Map tiles |
| [Open-Meteo](https://open-meteo.com/) | Current and hourly weather |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Open wildfire events |
| [Nominatim](https://nominatim.org/) | Reverse geocoding |

## Deployment

Vercel serves `public/` as the site root. No build step, so a push deploys the
files as they are.
