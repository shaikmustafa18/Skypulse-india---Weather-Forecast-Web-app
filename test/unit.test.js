"use strict";

/**
 * Offline test suite — run with `npm test`.
 *
 * Covers validation, CSV generation, forecast grouping and the HTTP routes
 * that fail before any upstream call. Nothing here needs an API key or a
 * network connection. End-to-end checks against the real APIs live in
 * test/live.test.js (`npm run test:live`).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseCity,
  parseDays,
  toFilenameSlug,
} = require("../server/utils/validation");
const {
  escapeCsvField,
  buildForecastCsv,
  UTF8_BOM,
} = require("../server/services/csvService");
const {
  groupForecastByDay,
  readPrecipitation,
  toLocalParts,
} = require("../server/services/weatherService");
const { TtlCache } = require("../server/utils/cache");
const { createApp } = require("../server/app");

// ---------------------------------------------------------------- fixtures

/** IST is UTC+5:30 — the offset OpenWeatherMap reports for Indian cities. */
const IST_OFFSET = 19800;

/**
 * Build a synthetic /forecast response: `slots` three-hour entries starting at
 * a fixed UTC instant. This is test data only — it is never presented as real
 * API output anywhere in the application.
 */
function makeForecastFixture(
  slots = 40,
  startUtc = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000,
) {
  const list = [];
  for (let i = 0; i < slots; i += 1) {
    const dt = startUtc + i * 3 * 3600;
    list.push({
      dt,
      main: {
        temp: 20 + (i % 8),
        temp_min: 19 + (i % 8),
        temp_max: 22 + (i % 8),
        humidity: 50 + (i % 10),
        pressure: 1010,
      },
      wind: { speed: 3 + (i % 3) },
      pop: (i % 5) / 10,
      rain: i % 4 === 0 ? { "3h": 1.5 } : undefined,
      weather: [
        { id: 500, main: "Rain", description: "light rain", icon: "10d" },
      ],
    });
  }
  return { list, city: { timezone: IST_OFFSET, name: "Testville" } };
}

function makeWeatherPayload(days) {
  return {
    query: "Hyderabad",
    location: {
      name: "Hyderabad",
      state: "Telangana",
      country: "India",
      latitude: 17.3606,
      longitude: 78.4741,
    },
    forecast: { days, availableDays: days.length, note: "test note" },
    units: { temperature: "°C", windSpeed: "m/s" },
  };
}

// -------------------------------------------------------------- validation

test("parseCity trims, collapses whitespace and accepts real Indian city names", () => {
  assert.equal(parseCity("  Hyderabad "), "Hyderabad");
  assert.equal(parseCity("navi   mumbai"), "navi mumbai");
  assert.equal(parseCity("Thiruvananthapuram"), "Thiruvananthapuram");
  assert.equal(parseCity("Puducherry"), "Puducherry");
  assert.equal(parseCity("Hubli-Dharwad"), "Hubli-Dharwad");
  // Express yields an array when a parameter repeats; the first value wins.
  assert.equal(parseCity(["Pune", "Delhi"]), "Pune");
});

test("parseCity rejects empty, too-short, too-long and unsafe input", () => {
  assert.throws(() => parseCity(undefined), { code: "EMPTY_CITY" });
  assert.throws(() => parseCity("   "), { code: "EMPTY_CITY" });
  assert.throws(() => parseCity("H"), { code: "INVALID_CITY" });
  assert.throws(() => parseCity("x".repeat(61)), { code: "INVALID_CITY" });
  assert.throws(() => parseCity("<script>alert(1)</script>"), {
    code: "INVALID_CITY",
  });
  assert.throws(() => parseCity("123456"), { code: "INVALID_CITY" });
  assert.throws(() => parseCity("Delhi; DROP TABLE"), { code: "INVALID_CITY" });
});

test("parseDays accepts 1 to 5, defaults to 5 and rejects everything else", () => {
  for (const value of [1, 2, 3, 4, 5]) {
    assert.equal(parseDays(String(value)), value);
  }
  assert.equal(parseDays(undefined), 5);
  assert.equal(parseDays(""), 5);

  for (const bad of [
    "0",
    "6",
    "-1",
    "2.5",
    "three",
    "1e1",
    " ",
    "NaN",
    "05x",
  ]) {
    assert.throws(
      () => parseDays(bad),
      { code: "INVALID_DAYS" },
      `should reject ${bad}`,
    );
  }
  // "05" is still an integer in range and is accepted.
  assert.equal(parseDays("05"), 5);
});

test("toFilenameSlug produces safe, descriptive filenames", () => {
  assert.equal(toFilenameSlug("Hyderabad"), "hyderabad");
  assert.equal(toFilenameSlug("Navi Mumbai"), "navi-mumbai");
  assert.equal(toFilenameSlug("Thiruvananthapuram"), "thiruvananthapuram");
  assert.equal(toFilenameSlug("../../etc/passwd"), "etc-passwd");
  assert.equal(toFilenameSlug("!!!"), "city");
});

// --------------------------------------------------------------------- CSV

test("escapeCsvField follows RFC 4180 and neutralises formula injection", () => {
  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField("a,b"), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField("line1\r\nline2"), '"line1\r\nline2"');
  assert.equal(escapeCsvField(" padded "), '" padded "');
  assert.equal(escapeCsvField(null), "");
  assert.equal(escapeCsvField(undefined), "");
  assert.equal(escapeCsvField(0), "0");
  // Leading =, +, - or @ would be read as a formula by Excel.
  assert.equal(escapeCsvField("=1+1"), "'=1+1");
  assert.equal(escapeCsvField("@SUM(A1)"), "'@SUM(A1)");
});

test("buildForecastCsv exports exactly the requested number of days", () => {
  const { days } = groupForecastByDay(makeForecastFixture());
  const payload = makeWeatherPayload(days);

  for (const requested of [1, 2, 3, 4, 5]) {
    const { csv, rowCount } = buildForecastCsv(payload, requested);
    assert.equal(rowCount, requested);

    const lines = csv.split("\r\n").filter(Boolean);
    const headerIndex = lines.findIndex((line) => line.startsWith("Date,Day,"));
    assert.ok(
      headerIndex > 0,
      "the table header should follow the metadata preamble",
    );

    const dataRows = lines.slice(headerIndex + 1);
    assert.equal(dataRows.length, requested, `expected ${requested} data rows`);

    // Only the first N dates of the forecast, in order, and nothing else.
    const exportedDates = dataRows.map((row) => row.split(",")[0]);
    assert.deepEqual(
      exportedDates,
      days.slice(0, requested).map((day) => day.date),
    );
  }
});

test("buildForecastCsv starts with a UTF-8 BOM and names the file after the city", () => {
  const { days } = groupForecastByDay(makeForecastFixture());
  const { csv, filename } = buildForecastCsv(makeWeatherPayload(days), 3);

  assert.ok(
    csv.startsWith(UTF8_BOM),
    "spreadsheets need the BOM to read °C correctly",
  );
  assert.equal(filename, "hyderabad-weather-forecast.csv");
  assert.ok(csv.includes("Hyderabad, Telangana, India"));
  assert.ok(csv.includes("Min Temp (C)"));
});

test("buildForecastCsv writes N/A for values the API did not report", () => {
  const payload = makeWeatherPayload([
    {
      date: "2026-01-01",
      weekday: "Thursday",
      intervals: 4,
      tempMin: 18,
      tempMax: 26,
      tempAvg: 22,
      humidity: null, // not reported
      precipitationMm: null, // not reported — must not become 0
      precipitationChance: null,
      windSpeedAvg: 3.1,
      condition: { main: "Clear", description: "clear sky" },
    },
  ]);

  const { csv } = buildForecastCsv(payload, 1);
  const row = csv.split("\r\n").find((line) => line.startsWith("2026-01-01"));
  const cells = row.split(",");

  assert.equal(cells[5], "N/A", "humidity");
  assert.equal(cells[6], "N/A", "precipitation");
  assert.equal(cells[7], "N/A", "precipitation chance");
  assert.ok(
    !row.includes(",0,"),
    "missing data must never be exported as zero",
  );
});

test("buildForecastCsv fails cleanly when there is no forecast data", () => {
  assert.throws(() => buildForecastCsv(makeWeatherPayload([]), 3), {
    code: "FORECAST_UNAVAILABLE",
  });
  assert.throws(() => buildForecastCsv({}, 3), {
    code: "FORECAST_UNAVAILABLE",
  });
});

test("CSV fields containing commas and quotes round-trip safely", () => {
  const payload = makeWeatherPayload([
    {
      date: "2026-01-01",
      weekday: "Thursday",
      intervals: 8,
      tempMin: 18,
      tempMax: 26,
      tempAvg: 22,
      humidity: 60,
      precipitationMm: 1.2,
      precipitationChance: 40,
      windSpeedAvg: 3.1,
      condition: {
        main: "Rain",
        description: 'heavy rain, thunder and "squalls"',
      },
    },
  ]);

  const { csv } = buildForecastCsv(payload, 1);
  assert.ok(csv.includes('"heavy rain, thunder and ""squalls"""'));
});

// -------------------------------------------------------- forecast grouping

test("groupForecastByDay buckets 3-hour entries into local calendar days", () => {
  const { days, timezoneOffsetSeconds } = groupForecastByDay(
    makeForecastFixture(),
  );

  assert.equal(timezoneOffsetSeconds, IST_OFFSET);
  assert.ok(days.length >= 5 && days.length <= 6, `got ${days.length} days`);

  // Dates must be unique and ascending.
  const dates = days.map((day) => day.date);
  assert.deepEqual(
    dates,
    [...dates].sort(),
    "days must be in chronological order",
  );
  assert.equal(new Set(dates).size, dates.length, "no duplicate dates");

  // Every full day has eight 3-hour intervals; the total must match the input.
  const totalIntervals = days.reduce((sum, day) => sum + day.intervals, 0);
  assert.equal(totalIntervals, 40);
});

test("groupForecastByDay computes min, max and average consistently", () => {
  const { days } = groupForecastByDay(makeForecastFixture());

  for (const day of days) {
    assert.ok(
      day.tempMin <= day.tempMax,
      `${day.date}: min must not exceed max`,
    );
    assert.ok(
      day.tempAvg >= day.tempMin && day.tempAvg <= day.tempMax,
      `${day.date}: average must fall inside the range`,
    );
    assert.ok(
      day.humidity >= 0 && day.humidity <= 100,
      `${day.date}: humidity in range`,
    );
    assert.ok(day.precipitationChance >= 0 && day.precipitationChance <= 100);
    assert.ok(typeof day.weekday === "string" && day.weekday.length > 0);
    assert.equal(typeof day.condition.description, "string");
  }
});

test("groupForecastByDay reports local dates, not UTC dates", () => {
  // 20:00 UTC on 1 Jan is 01:30 IST on 2 Jan — the entry belongs to the 2nd.
  const lateUtc = Date.UTC(2026, 0, 1, 20, 0, 0) / 1000;
  const { days } = groupForecastByDay(makeForecastFixture(1, lateUtc));
  assert.equal(days[0].date, "2026-01-02");
});

test("groupForecastByDay keeps precipitation null when nothing is reported", () => {
  const fixture = makeForecastFixture(8);
  for (const entry of fixture.list) delete entry.rain;

  const { days } = groupForecastByDay(fixture);
  assert.equal(
    days[0].precipitationMm,
    null,
    "no reported rain must stay null, not 0",
  );
});

test("groupForecastByDay rejects an empty or malformed forecast", () => {
  assert.throws(() => groupForecastByDay({ list: [] }), {
    code: "FORECAST_UNAVAILABLE",
  });
  assert.throws(() => groupForecastByDay(null), {
    code: "FORECAST_UNAVAILABLE",
  });
  assert.throws(() => groupForecastByDay({}), { code: "FORECAST_UNAVAILABLE" });
});

test("readPrecipitation handles 1h, 3h, snow and absent fields", () => {
  assert.deepEqual(readPrecipitation({ rain: { "3h": 2.4 } }), {
    rainMm: 2.4,
    snowMm: null,
    totalMm: 2.4,
  });
  assert.deepEqual(readPrecipitation({ rain: { "1h": 0.5 } }).totalMm, 0.5);
  assert.deepEqual(readPrecipitation({ snow: { "3h": 1 } }), {
    rainMm: null,
    snowMm: 1,
    totalMm: 1,
  });
  assert.deepEqual(readPrecipitation({}), {
    rainMm: null,
    snowMm: null,
    totalMm: null,
  });
  assert.deepEqual(readPrecipitation(undefined), {
    rainMm: null,
    snowMm: null,
    totalMm: null,
  });
});

test("toLocalParts converts a UTC timestamp into local wall-clock time", () => {
  // 06:30 UTC + 5:30 = 12:00 IST.
  const parts = toLocalParts(Date.UTC(2026, 0, 1, 6, 30, 0) / 1000, IST_OFFSET);
  assert.equal(parts.date, "2026-01-01");
  assert.equal(parts.time, "12:00");
  assert.equal(parts.weekday, "Thursday");
  assert.equal(toLocalParts(undefined, IST_OFFSET), null);
});

// ------------------------------------------------------------------- cache

test("TtlCache stores, expires and bounds its entries", async () => {
  const cache = new TtlCache({ ttlMs: 40, maxEntries: 2 });

  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);

  cache.set("b", 2);
  cache.set("c", 3); // over capacity: the least recently used entry ('a') goes
  assert.equal(cache.size, 2);
  assert.equal(cache.get("a"), undefined, "the oldest entry is evicted first");
  assert.equal(cache.get("b"), 2, "newer entries survive eviction");

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cache.get("c"), undefined, "entries expire after their TTL");
});

// ------------------------------------------------------------- HTTP routes

/** Start the app on an ephemeral port for the duration of one test. */
async function withServer(run) {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /api/health reports status without leaking the API key", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "up");
    assert.equal(typeof body.apiKeyConfigured, "boolean");

    const raw = JSON.stringify(body);
    assert.ok(
      !/appid|OPENWEATHER_API_KEY/i.test(raw),
      "the key must never be serialised",
    );
  });
});

test("GET /api/weather validates the city before calling any upstream API", async () => {
  await withServer(async (base) => {
    const cases = [
      ["", "EMPTY_CITY"],
      ["%20%20", "EMPTY_CITY"],
      ["H", "INVALID_CITY"],
      ["%3Cscript%3E", "INVALID_CITY"],
    ];

    for (const [query, expectedCode] of cases) {
      const response = await fetch(`${base}/api/weather?city=${query}`);
      assert.equal(response.status, 400, `city=${query}`);

      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, expectedCode);
      assert.ok(
        body.error.message.length > 0,
        "errors must carry a readable message",
      );
      assert.ok(!/stack|Error:|node_modules/i.test(body.error.message));
    }
  });
});

test("GET /api/forecast.csv rejects an out-of-range day count", async () => {
  await withServer(async (base) => {
    for (const days of ["0", "6", "12", "abc", "2.5"]) {
      const response = await fetch(
        `${base}/api/forecast.csv?city=Hyderabad&days=${days}`,
      );
      assert.equal(response.status, 400, `days=${days}`);

      const body = await response.json();
      assert.equal(body.error.code, "INVALID_DAYS");
    }
  });
});

test("unknown API routes return a structured 404", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/does-not-exist`);
    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "ROUTE_NOT_FOUND");
  });
});

test("the frontend is served and contains no API key", async () => {
  await withServer(async (base) => {
    for (const path of ["/", "/style.css", "/app.js"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);

      const text = await response.text();
      assert.ok(
        !/appid=|OPENWEATHER_API_KEY|api\.openweathermap\.org/i.test(text),
        `${path} must not reference the API key or call OpenWeatherMap directly`,
      );
    }
  });
});

test("security headers are present and Express does not advertise itself", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(
      response.headers
        .get("content-security-policy")
        .includes("default-src 'self'"),
    );
    assert.equal(response.headers.get("x-powered-by"), null);
    // No CORS header without an allow-listed Origin.
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("the rate limiter responds with 429 and a Retry-After header", async () => {
  const express = require("express");
  const { createRateLimiter } = require("../server/middleware/rateLimit");
  const { errorHandler } = require("../server/middleware/errorHandler");

  const app = express();
  app.use(createRateLimiter({ windowMs: 1000, maxRequests: 3 }));
  app.get("/ping", (req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    for (let i = 1; i <= 3; i += 1) {
      const response = await fetch(`${base}/ping`);
      assert.equal(response.status, 200, `request ${i} should pass`);
    }

    const blocked = await fetch(`${base}/ping`);
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));

    const body = await blocked.json();
    assert.equal(body.error.code, "RATE_LIMITED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
