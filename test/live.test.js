"use strict";

/**
 * End-to-end tests against the real OpenStreetMap Nominatim and
 * OpenWeatherMap APIs — run with `npm run test:live`.
 *
 * Requires:
 *   - a working internet connection
 *   - a valid OPENWEATHER_API_KEY in .env
 *
 * The geocoding tests run with or without a key; the weather and CSV tests
 * are skipped (not failed) when no key is configured, and the suite says so.
 *
 * Note: a brand-new OpenWeatherMap key can take up to a couple of hours to
 * activate. Until it does, these tests report INVALID_API_KEY — that is the
 * application handling a real upstream 401 correctly, not a bug.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const config = require("../server/config");
const { createApp } = require("../server/app");
const { geocodeCity } = require("../server/services/geocodingService");

const HAS_KEY = Boolean(config.openWeatherApiKey);

if (!HAS_KEY) {
  console.log(
    "\n  ⚠  OPENWEATHER_API_KEY is not set — weather and CSV tests will be skipped.\n" +
      "     Add your key to .env and re-run `npm run test:live` to exercise them.\n",
  );
}

let server;
let base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

// ------------------------------------------------- geocoding (no key needed)

test("Nominatim resolves Hyderabad to coordinates inside India", async () => {
  const location = await geocodeCity("Hyderabad");

  assert.ok(
    location.latitude > 6 && location.latitude < 37,
    "latitude within India",
  );
  assert.ok(
    location.longitude > 68 && location.longitude < 98,
    "longitude within India",
  );
  assert.match(location.country, /India/i);
  assert.ok(location.name.length > 0);
  assert.match(location.attribution, /OpenStreetMap/);
});

test("geocoding results are cached, so the second lookup makes no request", async () => {
  await geocodeCity("Mumbai"); // warm the cache
  const second = await geocodeCity("mumbai"); // different case, same cache key
  assert.equal(second.cached, true);
});

test("an unknown city is reported as not found", async () => {
  await assert.rejects(() => geocodeCity("Zzzzqqqxyznotacity"), {
    code: "CITY_NOT_FOUND",
  });
});

// --------------------------------------------------- weather (key required)

test(
  "GET /api/weather returns live data for Hyderabad",
  { skip: !HAS_KEY },
  async () => {
    const response = await fetch(`${base}/api/weather?city=Hyderabad`);
    const body = await response.json();

    assert.equal(
      response.status,
      200,
      `unexpected error: ${JSON.stringify(body.error)}`,
    );
    const { data } = body;

    // Location
    assert.match(data.location.country, /India/i);
    assert.ok(Number.isFinite(data.location.latitude));

    // Current weather, in Celsius and physically plausible for India
    assert.ok(
      Number.isFinite(data.current.temperature),
      "temperature must be numeric",
    );
    assert.ok(
      data.current.temperature > -20 && data.current.temperature < 60,
      `temperature ${data.current.temperature} should be Celsius, not Kelvin or Fahrenheit`,
    );
    assert.equal(data.units.temperature, "°C");
    assert.ok(
      data.current.humidity === null ||
        (data.current.humidity >= 0 && data.current.humidity <= 100),
    );
    assert.ok(typeof data.current.condition.description === "string");

    // Forecast
    assert.ok(data.forecast.days.length >= 1, "at least one forecast day");
    assert.ok(
      data.forecast.days.length <= 6,
      "the 5-day endpoint spans at most 6 local dates",
    );
    for (const day of data.forecast.days) {
      assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(day.tempMin <= day.tempMax, `${day.date}: min <= max`);
      assert.ok(day.intervals >= 1 && day.intervals <= 8);
    }

    // The API key must never appear in a response
    assert.ok(!JSON.stringify(body).includes(config.openWeatherApiKey));
  },
);

test("several Indian cities can be searched", { skip: !HAS_KEY }, async () => {
  // Spaced out to stay within the Nominatim one-request-per-second policy;
  // the geocoding service queues them automatically.
  for (const city of ["Mumbai", "Shillong", "Jaipur"]) {
    const response = await fetch(
      `${base}/api/weather?city=${encodeURIComponent(city)}`,
    );
    const body = await response.json();
    assert.equal(
      response.status,
      200,
      `${city}: ${JSON.stringify(body.error)}`,
    );
    assert.ok(
      Number.isFinite(body.data.current.temperature),
      `${city} temperature`,
    );
  }
});

test("an invalid city produces a readable error, not a stack trace", async () => {
  const response = await fetch(`${base}/api/weather?city=Zzzzqqqxyznotacity`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "CITY_NOT_FOUND");
  assert.match(body.error.message, /could not find/i);
  assert.ok(
    !/at .*\.js:\d+/.test(JSON.stringify(body)),
    "no stack trace in the response",
  );
});

// ------------------------------------------------------- CSV (key required)

test(
  "GET /api/forecast.csv returns exactly the requested days",
  { skip: !HAS_KEY },
  async () => {
    for (const days of [1, 3, 5]) {
      const response = await fetch(
        `${base}/api/forecast.csv?city=Hyderabad&days=${days}`,
      );
      assert.equal(response.status, 200, `days=${days}`);
      assert.match(response.headers.get("content-type"), /text\/csv/);
      assert.match(
        response.headers.get("content-disposition"),
        /attachment; filename="hyderabad-weather-forecast\.csv"/,
      );

      // The BOM has to be checked at byte level: fetch().text() decodes UTF-8
      // and strips a leading BOM, so the string form never shows it.
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(
        [...bytes.subarray(0, 3)],
        [0xef, 0xbb, 0xbf],
        "UTF-8 BOM for spreadsheet compatibility",
      );

      const csv = bytes.toString("utf8").replace(/^﻿/, "");
      const lines = csv.split("\r\n").filter(Boolean);
      const headerIndex = lines.findIndex((line) =>
        line.startsWith("Date,Day,"),
      );
      const dataRows = lines.slice(headerIndex + 1);

      assert.equal(
        dataRows.length,
        days,
        `expected ${days} data rows, got ${dataRows.length}`,
      );
      assert.ok(
        !csv.includes(config.openWeatherApiKey),
        "the key must not leak into the export",
      );
    }
  },
);

test(
  "the CSV dates match the dates shown by /api/weather",
  { skip: !HAS_KEY },
  async () => {
    const weather = await (await fetch(`${base}/api/weather?city=Pune`)).json();
    const expected = weather.data.forecast.days
      .slice(0, 3)
      .map((day) => day.date);

    const csv = await (
      await fetch(`${base}/api/forecast.csv?city=Pune&days=3`)
    ).text();
    const lines = csv.split("\r\n").filter(Boolean);
    const headerIndex = lines.findIndex((line) => line.startsWith("Date,Day,"));
    const exported = lines
      .slice(headerIndex + 1)
      .map((row) => row.split(",")[0]);

    assert.deepEqual(
      exported,
      expected,
      "the export must cover the dates the UI displays",
    );
  },
);
