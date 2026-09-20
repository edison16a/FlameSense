import test from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, interpolateColor, rgbToHex } from "../public/src/core/color.js";

test("hexToRgb splits a six-digit colour into channels", () => {
  assert.deepEqual(hexToRgb("#ff7f00"), { r: 255, g: 127, b: 0 });
  assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
});

test("hexToRgb tolerates a missing leading hash", () => {
  assert.deepEqual(hexToRgb("00ff00"), hexToRgb("#00ff00"));
});

test("rgbToHex zero-pads every channel", () => {
  // Regression guard: without padding, a channel below 16 yields one digit and
  // the whole string becomes five characters, which browsers reject outright --
  // a mid-animation frame would simply vanish.
  assert.equal(rgbToHex(1, 2, 3), "#010203");
  assert.equal(rgbToHex(0, 0, 0), "#000000");
  assert.equal(rgbToHex(255, 255, 255), "#ffffff");
});

test("hex round-trips through rgb unchanged", () => {
  for (const hex of ["#ff0000", "#ff7f00", "#ffff00", "#00ff00", "#010203"]) {
    const { r, g, b } = hexToRgb(hex);
    assert.equal(rgbToHex(r, g, b), hex);
  }
});

test("interpolateColor returns the endpoints exactly at t=0 and t=1", () => {
  // The animation depends on this: each phase hands its end colour to the next
  // phase's start colour, so any drift at the endpoints would show as a visible
  // seam between phases.
  assert.equal(interpolateColor("#ff0000", "#00ff00", 0), "#ff0000");
  assert.equal(interpolateColor("#ff0000", "#00ff00", 1), "#00ff00");
});

test("interpolateColor blends each channel independently at the midpoint", () => {
  assert.equal(interpolateColor("#ff0000", "#00ff00", 0.5), "#808000");
  assert.equal(interpolateColor("#000000", "#ffffff", 0.5), "#808080");
});

test("interpolateColor is monotonic across the red-to-orange ramp", () => {
  // Red -> orange only moves the green channel, so green must rise steadily.
  let previous = -1;
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const { g } = hexToRgb(interpolateColor("#ff0000", "#ff7f00", Math.min(t, 1)));
    assert.ok(g >= previous, `green went backwards at t=${t}`);
    previous = g;
  }
});
