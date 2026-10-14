# SkyPulse India — Weather Forecast Web Application

A responsive, full-stack weather dashboard for cities across India. Search any
Indian city to see live conditions and a 1–5 day forecast, then export that
forecast as a CSV file.

The OpenWeatherMap API key lives only on the server. The browser talks to this
application's own API and never to OpenWeatherMap directly.

---

## Table of contents

- [Features](#features)
- [Technology stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Folder structure](#folder-structure)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Getting an OpenWeatherMap API key](#getting-an-openweathermap-api-key)
- [Running the application](#running-the-application)
- [API documentation](#api-documentation)
- [CSV export](#csv-export)
- [How the daily forecast is calculated](#how-the-daily-forecast-is-calculated)
- [Error handling](#error-handling)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Attribution and API usage policies](#attribution-and-api-usage-policies)
- [Troubleshooting](#troubleshooting)
- [Publishing to GitHub](#publishing-to-github)
- [License](#license)

---

## Features

**Weather**

- City search restricted to India, resolved through OpenStreetMap Nominatim.
- Current conditions: temperature, feels-like, min/max, humidity, wind speed and
  direction, pressure, cloud cover, visibility, precipitation, sunrise/sunset
  and the city's local observation time.
- Daily forecast for 1, 2, 3, 4 or 5 days, built from OpenWeatherMap's
  five-day / three-hour forecast.
- Metrics the API does not report are labelled "Not reported" rather than shown
  as zero, so missing data is never mistaken for a real measurement.

**Export**

- Server-generated CSV containing exactly the number of forecast days selected
  in the interface.
- RFC 4180 escaping, CRLF line endings and a UTF-8 BOM so the file opens
  cleanly in Excel, LibreOffice, Numbers and Google Sheets.
- Descriptive filename, for example `hyderabad-weather-forecast.csv`.

**Interface**

- Mobile-first responsive layout verified at 320, 375, 768, 1024 and 1440 px
  with no horizontal overflow at any width.
- A headline card whose gradient is themed by the current condition — clear
  day, clear night, cloud, rain, thunder, snow and mist each have their own
  palette, all keeping white text well above 4.5:1 contrast.
- Animated inline SVG weather icons (the sun turns, clouds drift, rain falls,
  lightning flashes) — no icon font and no external image requests.
- Motion used sparingly and with purpose: a drifting background, staggered
  card entrances, a counting temperature, a sliding duration selector, and a
  bar on each forecast card showing where that day sits in the period's
  temperature range.
- Distinct states for first load, loading, success, and every error case.
- Semantic HTML, labelled controls, keyboard navigation, visible focus rings,
  `aria-live` announcements, 44px tap targets, and full support for
  `prefers-reduced-motion` (all decorative motion stops; only the loading
  spinner keeps turning).

**Backend**

- Modular Express application: routes, services, middleware and utilities are
  separated.
- Geocoding cache (24 h) and weather cache (10 min) to limit upstream traffic.
- Nominatim requests are queued to honour the one-request-per-second policy.
- Per-IP rate limiting, request timeouts, restrictive CORS and security headers.

---

## Technology stack

| Layer      | Technology                                        |
| ---------- | ------------------------------------------------- |
| Frontend   | HTML5, CSS3, JavaScript (ES6+)                    |
| Styling    | Tailwind CSS (CDN) + custom CSS in `public/style.css` |
| Backend    | Node.js, Express.js                               |
| Geocoding  | OpenStreetMap Nominatim                           |
| Weather    | OpenWeatherMap (current weather + 5 day forecast) |
| Config     | dotenv                                            |
| Tests      | Node's built-in `node:test` runner                |

Runtime dependencies are only `express` and `dotenv`. HTTP requests use Node's
built-in `fetch`, so there is no axios or node-fetch dependency.

> **Note on Tailwind:** the CDN build is used so the project runs with no build
> step. The browser console shows Tailwind's standard "should not be used in
> production" notice — that is expected. For a production deployment, install
> Tailwind as a PostCSS plugin and compile a stylesheet instead.

---

## Prerequisites

- **Node.js 18 or newer** (built-in `fetch` is required). Verify with `node -v`.
- **npm** (ships with Node.js).
- A free **OpenWeatherMap API key**.
- An internet connection — both upstream APIs are called from the server.

---

## Folder structure

```
weather-forecast-app/
├── public/                     # Frontend (served as static files)
│   ├── index.html              # Markup, page states, brand mark
│   ├── style.css               # Design tokens, components, animation, a11y
│   ├── app.js                  # Search, rendering, day selector, CSV download
│   └── assets/
│       ├── favicon.svg         # App icon (the same mark, on a tile)
│       └── README.txt
├── server/
│   ├── server.js               # Startup, port binding, graceful shutdown
│   ├── app.js                  # Express app, middleware order, static files
│   ├── config.js               # Environment variables and defaults
│   ├── routes/
│   │   └── api.js              # /api/health, /api/weather, /api/forecast.csv
│   ├── services/
│   │   ├── geocodingService.js # Nominatim lookup, cache, 1 req/sec queue
│   │   ├── weatherService.js   # OpenWeatherMap calls, normalising, grouping
│   │   └── csvService.js       # CSV building and escaping
│   ├── middleware/
│   │   ├── errorHandler.js     # Central error handling, 404s, asyncHandler
│   │   ├── rateLimit.js        # Per-IP fixed-window limiter
│   │   └── security.js         # CORS allow-list and security headers
│   └── utils/
│       ├── AppError.js         # Error type and user-facing error factories
│       ├── cache.js            # TTL cache with LRU eviction
│       ├── httpClient.js       # fetch with timeout and error translation
│       ├── logger.js           # Timestamped logging with secret redaction
│       └── validation.js       # Query-parameter validation
├── test/
│   ├── unit.test.js            # Offline tests (no key, no network)
│   └── live.test.js            # End-to-end tests against the real APIs
├── .env.example                # Copy to .env and add your key (never committed)
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

---

## Installation

```bash
git clone https://github.com/your-username/weather-forecast-app.git
cd weather-forecast-app
npm install
```

Then create your environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Open `.env` and set `OPENWEATHER_API_KEY`.

---

## Environment variables

| Variable                   | Required | Default                | Purpose                                                        |
| -------------------------- | -------- | ---------------------- | -------------------------------------------------------------- |
| `OPENWEATHER_API_KEY`      | **Yes**  | –                      | OpenWeatherMap API key. Server-side only.                       |
| `PORT`                     | No       | `3000`                 | Port the server listens on.                                     |
| `NODE_ENV`                 | No       | `development`          | `production` hides upstream error details from API responses.   |
| `NOMINATIM_USER_AGENT`     | No       | app name + repo URL    | Identifies your app to Nominatim. **Please set a real contact.** |
| `ALLOWED_ORIGINS`          | No       | empty (same-origin)    | Comma-separated origins allowed to call the API cross-origin.   |
| `RATE_LIMIT_WINDOW_MS`     | No       | `60000`                | Rate-limit window length.                                       |
| `RATE_LIMIT_MAX`           | No       | `60`                   | Requests allowed per IP per window.                             |
| `GEOCODE_CACHE_TTL_MS`     | No       | `86400000` (24 h)      | How long geocoding results are cached.                          |
| `WEATHER_CACHE_TTL_MS`     | No       | `600000` (10 min)      | How long weather responses are cached.                          |
| `NOMINATIM_MIN_INTERVAL_MS`| No       | `1100`                 | Minimum gap between Nominatim requests (policy: 1 per second).  |
| `OPENWEATHER_TIMEOUT_MS`   | No       | `8000`                 | Upstream request timeout.                                       |
| `NOMINATIM_TIMEOUT_MS`     | No       | `8000`                 | Upstream request timeout.                                       |

`.env` is listed in `.gitignore` and must never be committed.

---

## Getting an OpenWeatherMap API key

1. Create a free account at <https://home.openweathermap.org/users/sign_up>.
2. Open <https://home.openweathermap.org/api_keys>.
3. Copy the default key, or generate a new one.
4. Put it in `.env`:

   ```env
   OPENWEATHER_API_KEY=paste_your_key_here
   ```

5. Restart the server.

> **A new key is not active immediately.** OpenWeatherMap usually takes from a
> few minutes up to two hours to activate it. Until then the API returns HTTP
> 401 and the app shows *"The weather service rejected our API key."* That is
> the application correctly reporting an upstream rejection — wait and retry.

The free plan covers the two endpoints this project uses: Current Weather Data
and the 5 day / 3 hour Forecast.

---

## Running the application

```bash
npm start
```

Then open <http://localhost:3000>.

For development with automatic restarts on file changes:

```bash
npm run dev
```

Check that the server is configured correctly:

```bash
curl http://localhost:3000/api/health
```

```json
{ "ok": true, "status": "up", "apiKeyConfigured": true, "environment": "development", "time": "..." }
```

If `apiKeyConfigured` is `false`, the `.env` file is missing or the key is not set.

---

## API documentation

### `GET /api/health`

Readiness probe. Reports whether a key is configured, without revealing it.

### `GET /api/weather?city=<name>`

Resolves the city, then returns current weather and the grouped forecast.

**Example**

```bash
curl "http://localhost:3000/api/weather?city=Hyderabad"
```

**Response (abridged)**

```json
{
  "ok": true,
  "data": {
    "query": "Hyderabad",
    "location": {
      "name": "Hyderabad",
      "state": "Telangana",
      "country": "India",
      "latitude": 17.360589,
      "longitude": 78.4740613
    },
    "coordinates": { "latitude": 17.360589, "longitude": 78.4740613 },
    "current": {
      "observedAt": { "date": "2026-10-14", "time": "15:20", "weekday": "Wednesday" },
      "temperature": 27.4,
      "feelsLike": 29.8,
      "tempMin": 25.2,
      "tempMax": 30.1,
      "humidity": 74,
      "pressure": 1011,
      "windSpeed": 4.2,
      "windDirection": 250,
      "cloudiness": 72,
      "visibility": 7000,
      "precipitation": { "rainMm": 1.8, "snowMm": null, "totalMm": 1.8 },
      "condition": { "id": 501, "main": "Rain", "description": "moderate rain", "icon": "10d" },
      "sunrise": { "time": "06:12" },
      "sunset": { "time": "18:05" }
    },
    "forecast": {
      "days": [
        {
          "date": "2026-10-14",
          "weekday": "Wednesday",
          "intervals": 3,
          "tempMin": 24.1,
          "tempMax": 30.2,
          "tempAvg": 27.0,
          "humidity": 68,
          "pressure": 1010,
          "windSpeedAvg": 3.5,
          "precipitationMm": 3.0,
          "precipitationChance": 20,
          "condition": { "main": "Rain", "description": "light rain", "icon": "10d" }
        }
      ],
      "availableDays": 6,
      "source": "OpenWeatherMap 5 day / 3 hour forecast",
      "note": "Daily values are calculated from the available 3-hour forecast intervals. The first and last days may cover only part of the day."
    },
    "units": { "temperature": "°C", "windSpeed": "m/s", "pressure": "hPa", "humidity": "%", "precipitation": "mm" },
    "attribution": { "weather": "Weather data © OpenWeatherMap", "geocoding": "Location data © OpenStreetMap contributors (ODbL)" },
    "retrievedAt": "2026-10-14T09:50:00.000Z",
    "cached": false
  }
}
```

Any value the upstream API did not report is `null` — the server never
substitutes a default.

### `GET /api/forecast.csv?city=<name>&days=<1-5>`

Returns a downloadable CSV. `days` defaults to `5` and must be an integer
between 1 and 5.

```bash
curl -OJ "http://localhost:3000/api/forecast.csv?city=Hyderabad&days=3"
```

Response headers:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="hyderabad-weather-forecast.csv"
```

### Error format

Every error — from any endpoint — uses the same shape:

```json
{
  "ok": false,
  "error": {
    "code": "CITY_NOT_FOUND",
    "message": "We could not find \"Atlantis\" in India. Please check the spelling or try a nearby larger city.",
    "retryable": false
  }
}
```

`message` is always safe to show to a user. In development only, a `details`
field carries the upstream reason; it is omitted when `NODE_ENV=production`.

| Code                    | HTTP | Meaning                                       |
| ----------------------- | ---- | --------------------------------------------- |
| `EMPTY_CITY`            | 400  | No city supplied                              |
| `INVALID_CITY`          | 400  | City failed validation                        |
| `INVALID_DAYS`          | 400  | `days` outside 1–5, or not an integer         |
| `CITY_NOT_FOUND`        | 404  | Nominatim found no match in India             |
| `ROUTE_NOT_FOUND`       | 404  | Unknown API route                             |
| `RATE_LIMITED`          | 429  | This server's own per-IP limit                |
| `UPSTREAM_RATE_LIMITED` | 429  | OpenWeatherMap or Nominatim throttled us      |
| `MISSING_API_KEY`       | 500  | `OPENWEATHER_API_KEY` is not configured       |
| `CSV_FAILED`            | 500  | CSV could not be generated                    |
| `GEOCODING_BLOCKED`     | 502  | Nominatim refused our User-Agent (HTTP 403)   |
| `INVALID_API_KEY`       | 502  | OpenWeatherMap rejected the key (HTTP 401)    |
| `FORECAST_UNAVAILABLE`  | 502  | No usable forecast data returned              |
| `UPSTREAM_UNAVAILABLE`  | 503  | Upstream service error                        |
| `NETWORK_ERROR`         | 503  | The server could not reach the upstream API   |
| `UPSTREAM_TIMEOUT`      | 504  | Upstream exceeded the request timeout         |

---

## CSV export

In the interface:

1. Search for a city.
2. Choose 1–5 days with the duration selector.
3. The forecast cards update immediately.
4. Click **Export CSV**.
5. The browser downloads a file covering exactly those days.

A confirmation (or a readable failure message) appears beneath the button.

**File layout** — a short metadata preamble, a blank line, then the table:

```csv
Weather Forecast Export
Location,"Hyderabad, Telangana, India"
Coordinates,"17.3606, 78.4741"
Forecast Days,3
Generated At (UTC),2026-10-14T09:50:00.000Z
Units,"Temperature °C, Wind m/s, Precipitation mm"
Source,OpenWeatherMap 5 day / 3 hour forecast
Geocoding,"OpenStreetMap Nominatim, © OpenStreetMap contributors"
Note,Daily values are calculated from the available 3-hour forecast intervals; ...

Date,Day,Min Temp (C),Max Temp (C),Avg Temp (C),Humidity (%),Precipitation (mm),Precipitation Chance (%),Avg Wind Speed (m/s),Condition,Description,Forecast Intervals
2026-10-14,Wednesday,24.1,30.2,27,68,3,20,3.5,Rain,light rain,3
2026-10-15,Thursday,23.8,31.4,27.3,75,4.6,60,4.6,Rain,moderate rain,8
2026-10-16,Friday,22.9,32.1,27.2,68,N/A,60,4.5,Clear,clear sky,8
```

Details worth knowing:

- **`N/A`** means the API did not report that value. It is never written as `0`.
- Fields containing commas, quotes or newlines are quoted and escaped per
  RFC 4180.
- Values starting with `=`, `+`, `-` or `@` are prefixed with an apostrophe so
  spreadsheets do not execute them as formulas.
- The file begins with a UTF-8 BOM so `°C` and Indian city names render
  correctly in Excel.
- **Forecast Intervals** is how many 3-hour entries that day's figures came
  from; 8 is a full day.

---

## How the daily forecast is calculated

OpenWeatherMap's free plan has no "daily forecast" endpoint. It returns up to
40 entries spaced three hours apart, which this application groups into days:

1. Each entry's timestamp is shifted by the city's timezone offset, so entries
   are bucketed by **local** calendar date, not UTC date.
2. For each date:
   - **Min / max** — the lowest and highest values across that day's entries.
   - **Average temp / humidity / wind** — the mean of that day's entries.
   - **Precipitation** — the sum of reported millimetres; `null` when no entry
     reported any.
   - **Chance of precipitation** — the highest `pop` value of the day, as a
     percentage.
   - **Condition** — taken from the entry closest to local midday, so a day is
     described by its daytime weather rather than by a midnight reading.
3. The first and last days are usually **partial**, because the forecast starts
   at the next three-hour slot. Each day records its interval count, the cards
   label partial days, and the CSV includes the count in a column.

This is why the API may report six dates for a "five-day" forecast: the current
day's remaining hours plus five full days.

---

## Error handling

Handled explicitly, in the UI and on the server:

| Situation                      | What happens                                                       |
| ------------------------------ | ------------------------------------------------------------------ |
| Empty search                   | Inline field message; no request is sent                            |
| Invalid characters             | Inline field message; rejected again server-side                    |
| Unknown city                   | "City not found" panel with the searched name                       |
| Browser offline                | Offline panel with a retry button                                   |
| Server unreachable             | Connection panel with a retry button                                |
| Missing API key                | Configuration message; the server also warns at startup             |
| Invalid/inactive API key       | "The weather service rejected our API key."                         |
| Upstream rate limit            | "Too many requests" with advice to wait                             |
| This server's rate limit       | HTTP 429 plus a `Retry-After` header                                |
| Upstream timeout               | Timeout panel with a retry button                                   |
| Forecast data unavailable      | Dedicated message, current weather still shown where possible       |
| CSV download failure           | Inline message under the Export button; the forecast stays on screen |

A failed search clears the previous result, so stale data is never left on
screen looking like a fresh success. Stack traces and upstream payloads are
logged on the server, never sent to the browser in production.

---

## Testing

### Offline tests — no API key, no network

```bash
npm test
```

25 tests covering validation, CSV escaping and day slicing, forecast grouping
(including local-date bucketing and null precipitation), the TTL cache, route
validation, security headers, the rate limiter, and an assertion that no API
key appears in any served frontend file.

### Live tests — real APIs

```bash
npm run test:live
```

- **Geocoding tests** run with or without a key (Nominatim needs none).
- **Weather and CSV tests** are **skipped with a printed notice** when
  `OPENWEATHER_API_KEY` is not set. Add a valid key to `.env` to run them.

They verify that Hyderabad returns live data, that temperatures are in a
plausible Celsius range, that other Indian cities work, that unknown cities
produce a clean 404, and that the CSV row count and dates match what
`/api/weather` returned.

### Manual checklist

1. Search `Hyderabad` — current conditions and forecast appear.
2. Search `Mumbai`, `Shillong`, `Thiruvananthapuram` — all work; long names wrap.
3. Search `Zzzzqqq` — a readable "city not found" message.
4. Submit an empty field — inline validation, no request sent.
5. Switch between 1–5 days — the card count changes immediately.
6. Export CSV at 1, 3 and 5 days — row counts match; the file opens in Excel.
7. Resize to 320, 375, 768, 1024 and 1440 px — no horizontal scrollbar.
8. Tab through the page — focus is always visible; the selector takes arrow keys.
9. Open DevTools → Network — the browser only ever calls `/api/...`.
10. Search `app.js` for your key — it is not there.

---

## Security notes

- The API key is read from the environment on the server and is never sent to
  the browser; the logger redacts `appid=` from any logged URL.
- `.env` and `node_modules/` are gitignored.
- All query parameters are validated server-side; frontend validation is a
  convenience only.
- Per-IP rate limiting on `/api` (60 requests/minute by default).
- Every upstream request has an 8-second timeout via `AbortController`.
- CORS is deny-by-default: headers are only sent for origins in
  `ALLOWED_ORIGINS`. There is no wildcard.
- Security headers include a Content-Security-Policy with `connect-src 'self'`,
  plus `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`.
  `X-Powered-By` is removed.
- The frontend renders all API text with `textContent`, never `innerHTML`, so a
  weather description cannot inject markup.
- CSV values are escaped and formula-injection prefixes are neutralised.

> The in-memory rate limiter and caches are per-process. Behind a load balancer
> or on multiple instances, move them to a shared store such as Redis.

---

## Attribution and API usage policies

This project displays attribution for both data sources in the page footer, as
their terms require.

**OpenStreetMap Nominatim** — [usage policy](https://operations.osmfoundation.org/policies/nominatim/)

- Maximum one request per second: requests are queued with a minimum 1.1 s gap.
- A descriptive `User-Agent` is sent — set `NOMINATIM_USER_AGENT` to one with
  your own contact details before deploying.
- Results are cached for 24 hours to avoid repeat lookups.
- No autocomplete: a request is sent only when the user submits the form.
- Data © OpenStreetMap contributors, available under the ODbL.

**OpenWeatherMap** — [terms](https://openweathermap.org/terms)

- Free-plan limits apply (60 calls/minute, 1,000,000 calls/month at the time of
  writing). Responses are cached for 10 minutes per location.
- Weather data © OpenWeatherMap.

If you deploy this publicly, review both policies yourself — they change.

---

## Troubleshooting

**"The weather service is not configured yet."**
`OPENWEATHER_API_KEY` is missing. Check that `.env` exists in the project root
(not in `server/`), has no quotes around the value, and restart the server.

**"The weather service rejected our API key."**
The key is wrong or not yet activated. New keys can take up to two hours.
Verify it directly:

```bash
curl "https://api.openweathermap.org/data/2.5/weather?lat=17.36&lon=78.47&units=metric&appid=YOUR_KEY"
```

**"The OpenStreetMap location service refused our request." (HTTP 403)**
Nominatim rejected your `NOMINATIM_USER_AGENT`. It blocks placeholder contacts
— an `example.com` address is refused outright. Set it to a real repository URL
or contact address in `.env` and restart:

```env
NOMINATIM_USER_AGENT=SkyPulseIndia/1.0 (weather forecast app; https://github.com/your-username/weather-forecast-app)
```

**`Error: Cannot find module 'express'`**
Run `npm install`.

**`Port 3000 is already in use`**
Set a different `PORT` in `.env`, or stop the process using the port:
`npx kill-port 3000`.

**`fetch is not defined`**
You are on Node 16 or older. Upgrade to Node 18+.

**"We could not find … in India."**
Searches are restricted to India (`countrycodes=in`). Check the spelling, or try
a larger nearby city — Nominatim does not know every small locality.

**"You are sending requests a little too quickly."**
This server's own rate limit. Wait for the window to pass, or raise
`RATE_LIMIT_MAX` in `.env` for local development.

**The CSV shows `N/A` in some columns.**
Correct behaviour: OpenWeatherMap did not report that value for that day.
Precipitation is commonly absent when no rain is forecast.

**Numbers look odd in Excel.**
Open the file with UTF-8 encoding. The BOM should make this automatic; if your
spreadsheet still mangles characters, import it explicitly as UTF-8.

**Tailwind warning in the console.**
Expected with the CDN build. See the note under [Technology stack](#technology-stack).

---

## Publishing to GitHub

First confirm no secrets are staged:

```bash
cat .gitignore          # must list .env and node_modules/
git status              # .env must NOT appear
```

Then initialise and push:

```bash
git init
git add .
git commit -m "Initial commit: weather forecast web application"
git branch -M main
git remote add origin https://github.com/your-username/weather-forecast-app.git
git push -u origin main
```

If the repository already has commits (for example a README created on GitHub):

```bash
git pull --rebase origin main
git push -u origin main
```

Commit `.env.example`, never `.env`. If a key is ever committed by accident,
revoke it in the OpenWeatherMap dashboard immediately and issue a new one —
rewriting history is not enough, because the old value may already be cached.

---

## License

MIT. See the `license` field in `package.json`.

Weather data © OpenWeatherMap. Location data © OpenStreetMap contributors,
available under the Open Database Licence (ODbL).
