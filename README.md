# SkyPulse India — Weather Forecast App

Search any city in India for current conditions and a 1–5 day forecast, then
export that forecast as CSV. Node/Express backend, vanilla JS frontend.

The OpenWeatherMap API key stays on the server — the browser only ever calls
this app's own `/api`.

---

## Stack

HTML5 · CSS3 · JavaScript (ES6+) · Tailwind (CDN, layout utilities) ·
Node.js · Express · OpenStreetMap Nominatim (geocoding) · OpenWeatherMap
(weather) · dotenv. Only two dependencies: `express` and `dotenv`.

**Requires Node 18+** (uses built-in `fetch`).

---

## Setup

```bash
npm install
cp .env.example .env     # Windows: Copy-Item .env.example .env
```

Add your key from [openweathermap.org/api_keys](https://home.openweathermap.org/api_keys) to `.env`:

```env
OPENWEATHER_API_KEY=your_api_key
```

> A new key takes up to 2 hours to activate. Until then the app correctly
> reports *"The weather service rejected our API key."*

```bash
npm start        # http://localhost:3000
```

Check config: `curl http://localhost:3000/api/health` → `"apiKeyConfigured": true`

---

## Environment variables

| Variable                | Required | Default       | Purpose                                   |
| ----------------------- | -------- | ------------- | ----------------------------------------- |
| `OPENWEATHER_API_KEY`   | **Yes**  | –             | Weather API key. Server-side only.        |
| `PORT`                  | No       | `3000`        | Server port.                              |
| `NODE_ENV`              | No       | `development` | `production` hides upstream error details.|
| `NOMINATIM_USER_AGENT`  | No       | app + repo URL| Identifies the app to Nominatim.          |
| `ALLOWED_ORIGINS`       | No       | empty         | Cross-origin allow-list (deny by default).|

⚠️ **Never use an `example.com` address in `NOMINATIM_USER_AGENT`** — Nominatim
rejects it with HTTP 403 and city search stops working.

---

## API

| Endpoint                                    | Returns                                     |
| ------------------------------------------- | ------------------------------------------- |
| `GET /api/health`                            | Status; whether a key is configured         |
| `GET /api/weather?city=Hyderabad`            | Location, current weather, 5-day forecast   |
| `GET /api/forecast.csv?city=Hyderabad&days=3`| Downloadable CSV of exactly `days` dates    |

`days` must be an integer 1–5. All parameters are validated server-side.

Errors are uniform and safe to display:

```json
{ "ok": false, "error": { "code": "CITY_NOT_FOUND", "message": "We could not find …", "retryable": false } }
```

Codes: `EMPTY_CITY` `INVALID_CITY` `INVALID_DAYS` `CITY_NOT_FOUND` `RATE_LIMITED`
`UPSTREAM_RATE_LIMITED` `MISSING_API_KEY` `INVALID_API_KEY` `GEOCODING_BLOCKED`
`FORECAST_UNAVAILABLE` `UPSTREAM_UNAVAILABLE` `NETWORK_ERROR` `UPSTREAM_TIMEOUT`
`CSV_FAILED`

---

## Forecast & CSV

OpenWeatherMap's free plan has no daily endpoint, so the app groups the
5-day / 3-hour forecast into days **by local date**, taking min/max from the
day's extremes and the condition from the entry nearest local midday.

The first and last days are usually **partial**; each card and CSV row records
how many of the 8 intervals it came from.

CSV: RFC 4180 escaping, CRLF, UTF-8 BOM (opens correctly in Excel), formula
injection neutralised. **`N/A` means the API did not report that value — never
substituted with `0`.**

---

## Tests

```bash
npm test         # 25 offline tests — no key, no network
npm run test:live # real APIs; weather tests skip (with a notice) if no key
```

---

## Troubleshooting

| Problem | Cause |
| ------- | ----- |
| "Weather service not configured" | `.env` missing or key unset — must be in the project root |
| "Rejected our API key" | Key wrong, or not yet activated (up to 2h) |
| "Location service refused our request" | `NOMINATIM_USER_AGENT` uses a placeholder `example.com` address |
| `Cannot find module 'express'` | Run `npm install` |
| `fetch is not defined` | Node < 18 — upgrade |
| CSV shows `N/A` | Correct: that value wasn't reported |

---

## Attribution

Weather data © [OpenWeatherMap](https://openweathermap.org/). Location data ©
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL),
via [Nominatim](https://nominatim.openstreetmap.org/) — whose policy (max 1
request/second, identifiable User-Agent, cached results) this app follows.
Both are credited in the app footer.

---

## Publish to GitHub

```bash
git add -A
git commit -m "Initial commit: SkyPulse India weather forecast app"
git branch -M main
git remote add origin https://github.com/your-username/weather-forecast-app.git
git push -u origin main
```

`.env` and `node_modules/` are gitignored — verify with `git status` before pushing.

---

📖 **Full documentation** — folder structure, complete API response examples,
security notes, manual test checklist: [`docs/REFERENCE.md`](docs/REFERENCE.md)

MIT licensed.
