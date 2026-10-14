'use strict';

const config = require('../config');
const { fetchJson } = require('../utils/httpClient');
const { TtlCache } = require('../utils/cache');
const { errors } = require('../utils/AppError');
const logger = require('../utils/logger');
const { geocodeCity } = require('./geocodingService');

const SERVICE_NAME = 'The OpenWeatherMap weather service';

/**
 * Weather changes slowly relative to how often a user re-searches the same
 * city, so responses are cached briefly. This keeps usage well inside the free
 * OpenWeatherMap quota.
 */
const weatherCache = new TtlCache({ ttlMs: config.openWeather.cacheTtlMs, maxEntries: 200 });

/** Round to one decimal place; non-numbers become null. */
function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

/** Return a finite number or null — never invent a value for a missing field. */
function num(value) {
  return Number.isFinite(value) ? value : null;
}

/** Average the finite values of an array, or null when none are available. */
function average(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

/**
 * Format a UNIX timestamp in the location's own local time using the timezone
 * offset OpenWeatherMap reports (seconds east of UTC). Adding the offset to the
 * UTC timestamp and then reading the UTC parts yields local wall-clock time
 * without needing a timezone database.
 */
function toLocalParts(unixSeconds, timezoneOffsetSeconds) {
  if (!Number.isFinite(unixSeconds)) return null;
  const offset = Number.isFinite(timezoneOffsetSeconds) ? timezoneOffsetSeconds : 0;
  const shifted = new Date((unixSeconds + offset) * 1000);
  const iso = shifted.toISOString(); // e.g. 2026-10-14T17:30:00.000Z
  return {
    isoLocal: iso.slice(0, 19),
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    weekday: shifted.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }),
    utcIso: new Date(unixSeconds * 1000).toISOString(),
  };
}

/**
 * Precipitation in OpenWeatherMap responses is reported as `rain`/`snow`
 * volume in millimetres, keyed by the measurement window ("1h" or "3h"). The
 * key present depends on the endpoint, so both are checked. An absent field
 * means "nothing reported" and stays null — it is not reported as 0 mm.
 */
function readPrecipitation(entry) {
  const rain = num(entry?.rain?.['3h'] ?? entry?.rain?.['1h']);
  const snow = num(entry?.snow?.['3h'] ?? entry?.snow?.['1h']);
  if (rain === null && snow === null) return { rainMm: null, snowMm: null, totalMm: null };
  return {
    rainMm: round1(rain),
    snowMm: round1(snow),
    totalMm: round1((rain ?? 0) + (snow ?? 0)),
  };
}

/** Shared condition shape for current weather and forecast entries. */
function readCondition(entry) {
  const weather = Array.isArray(entry?.weather) ? entry.weather[0] : null;
  return {
    id: weather?.id ?? null,
    main: weather?.main ?? null,
    description: weather?.description ?? null,
    icon: weather?.icon ?? null,
  };
}

/** Build a request URL for an OpenWeatherMap endpoint. */
function buildUrl(baseUrl, { latitude, longitude }) {
  if (!config.openWeatherApiKey) throw errors.missingApiKey();
  const url = new URL(baseUrl);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('units', config.openWeather.units); // Celsius + m/s
  url.searchParams.set('appid', config.openWeatherApiKey);
  return url.toString();
}

/** Translate OpenWeatherMap status codes into user-facing errors. */
function assertOk({ status, ok, data }) {
  if (ok) return;
  if (status === 401) throw errors.invalidApiKey(data?.message);
  if (status === 429) throw errors.rateLimited(data?.message);
  if (status === 404) throw errors.forecastUnavailable();
  logger.warn('OpenWeatherMap returned an error status', { status });
  throw errors.upstreamUnavailable(SERVICE_NAME, `status ${status}`);
}

/** GET the current-weather endpoint and normalise the payload. */
async function fetchCurrentWeather(coords) {
  const response = await fetchJson(buildUrl(config.openWeather.currentUrl, coords), {
    timeoutMs: config.openWeather.timeoutMs,
    serviceName: SERVICE_NAME,
  });
  assertOk(response);

  const data = response.data || {};
  const timezoneOffset = num(data.timezone);
  const main = data.main || {};

  return {
    observedAt: toLocalParts(num(data.dt), timezoneOffset),
    timezoneOffsetSeconds: timezoneOffset,
    temperature: round1(num(main.temp)),
    feelsLike: round1(num(main.feels_like)),
    tempMin: round1(num(main.temp_min)),
    tempMax: round1(num(main.temp_max)),
    humidity: num(main.humidity),
    pressure: num(main.pressure),
    visibility: num(data.visibility),
    cloudiness: num(data.clouds?.all),
    windSpeed: round1(num(data.wind?.speed)),
    windDirection: num(data.wind?.deg),
    windGust: round1(num(data.wind?.gust)),
    precipitation: readPrecipitation(data),
    condition: readCondition(data),
    sunrise: toLocalParts(num(data.sys?.sunrise), timezoneOffset),
    sunset: toLocalParts(num(data.sys?.sunset), timezoneOffset),
  };
}

/**
 * Pick the condition that best represents a day.
 *
 * The 3-hour entry closest to local midday is used, because that is the slot a
 * reader means by "the day's weather" — a midnight entry would describe a clear
 * night for a day that actually turns rainy.
 */
function pickRepresentativeCondition(entries) {
  let best = entries[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const hour = Number.parseInt(entry.localParts?.time?.slice(0, 2) ?? '12', 10);
    const distance = Math.abs((Number.isFinite(hour) ? hour : 12) - 12);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

/** Reduce one day's 3-hour entries into a single daily summary. */
function summariseDay(date, entries) {
  // temp_min/temp_max inside a 3-hour slot are close to the slot temperature;
  // the real daily range comes from the extremes across all of the day's slots.
  const lows = entries.map((e) => e.tempMin ?? e.temp).filter(Number.isFinite);
  const highs = entries.map((e) => e.tempMax ?? e.temp).filter(Number.isFinite);
  const humidityAvg = average(entries.map((e) => e.humidity));
  const pressureAvg = average(entries.map((e) => e.pressure));

  // Precipitation is the sum of reported millimetres across the day's slots.
  // If no slot reported any, the value stays null ("not reported") rather than
  // becoming a misleading 0 mm.
  const reportedPrecip = entries.map((e) => e.precipitation.totalMm).filter(Number.isFinite);

  // Probability of precipitation (`pop`) is a 0–1 fraction per slot; the day's
  // headline chance is the highest slot value, expressed as a percentage.
  const pops = entries.map((e) => e.probabilityOfPrecipitation).filter(Number.isFinite);

  return {
    date,
    weekday: entries[0].localParts.weekday,
    intervals: entries.length,
    tempMin: lows.length ? round1(Math.min(...lows)) : null,
    tempMax: highs.length ? round1(Math.max(...highs)) : null,
    tempAvg: round1(average(entries.map((e) => e.temp))),
    humidity: humidityAvg === null ? null : Math.round(humidityAvg),
    pressure: pressureAvg === null ? null : Math.round(pressureAvg),
    windSpeedAvg: round1(average(entries.map((e) => e.windSpeed))),
    precipitationMm: reportedPrecip.length
      ? round1(reportedPrecip.reduce((sum, value) => sum + value, 0))
      : null,
    precipitationChance: pops.length ? Math.round(Math.max(...pops) * 100) : null,
    condition: pickRepresentativeCondition(entries).condition,
  };
}

/**
 * Group the five-day / three-hour forecast into per-day summaries.
 *
 * OpenWeatherMap's /forecast endpoint returns up to 40 entries spaced three
 * hours apart. Entries are bucketed by the *local* calendar date (derived from
 * the city's timezone offset) and each bucket is reduced by summariseDay().
 * The first and last buckets are usually partial — the current day starts at
 * the next 3-hour slot — so every summary records how many intervals it was
 * computed from, and both the UI and the CSV surface that count.
 */
function groupForecastByDay(forecastResponse) {
  const list = Array.isArray(forecastResponse?.list) ? forecastResponse.list : [];
  if (list.length === 0) throw errors.forecastUnavailable();

  const timezoneOffset = num(forecastResponse?.city?.timezone) ?? 0;
  const buckets = new Map();

  for (const raw of list) {
    const localParts = toLocalParts(num(raw.dt), timezoneOffset);
    if (!localParts) continue;

    const entry = {
      localParts,
      temp: num(raw.main?.temp),
      tempMin: num(raw.main?.temp_min),
      tempMax: num(raw.main?.temp_max),
      humidity: num(raw.main?.humidity),
      pressure: num(raw.main?.pressure),
      windSpeed: num(raw.wind?.speed),
      precipitation: readPrecipitation(raw),
      probabilityOfPrecipitation: num(raw.pop),
      condition: readCondition(raw),
    };

    if (!buckets.has(localParts.date)) buckets.set(localParts.date, []);
    buckets.get(localParts.date).push(entry);
  }

  const days = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => summariseDay(date, entries));

  if (days.length === 0) throw errors.forecastUnavailable();
  return { days, timezoneOffsetSeconds: timezoneOffset };
}

/** GET the five-day forecast endpoint and reduce it to daily summaries. */
async function fetchForecast(coords) {
  const response = await fetchJson(buildUrl(config.openWeather.forecastUrl, coords), {
    timeoutMs: config.openWeather.timeoutMs,
    serviceName: SERVICE_NAME,
  });
  assertOk(response);
  return groupForecastByDay(response.data);
}

/**
 * Resolve a city, then fetch its current weather and forecast together.
 *
 * @param {string} city validated city name
 * @returns {Promise<object>} the payload served by GET /api/weather
 */
async function getWeatherForCity(city) {
  const location = await geocodeCity(city);

  // Cache on rounded coordinates: different spellings of one city resolve to
  // the same point, so they share a cache entry.
  const cacheKey = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached) return { ...cached, query: city, cached: true };

  // The two upstream calls are independent, so they run concurrently.
  const [current, forecast] = await Promise.all([
    fetchCurrentWeather(location),
    fetchForecast(location),
  ]);

  const payload = {
    query: city,
    location: {
      name: location.name,
      state: location.state,
      country: location.country,
      displayName: location.displayName,
      latitude: location.latitude,
      longitude: location.longitude,
    },
    coordinates: { latitude: location.latitude, longitude: location.longitude },
    current,
    forecast: {
      days: forecast.days,
      availableDays: forecast.days.length,
      source: 'OpenWeatherMap 5 day / 3 hour forecast',
      note:
        'Daily values are calculated from the available 3-hour forecast intervals. ' +
        'The first and last days may cover only part of the day.',
    },
    units: {
      temperature: '°C',
      windSpeed: 'm/s',
      pressure: 'hPa',
      humidity: '%',
      precipitation: 'mm',
      visibility: 'm',
    },
    timezoneOffsetSeconds: current.timezoneOffsetSeconds ?? forecast.timezoneOffsetSeconds,
    attribution: {
      weather: 'Weather data © OpenWeatherMap',
      geocoding: location.attribution,
    },
    retrievedAt: new Date().toISOString(),
    cached: false,
  };

  weatherCache.set(cacheKey, payload);
  return payload;
}

module.exports = {
  getWeatherForCity,
  groupForecastByDay,
  summariseDay,
  weatherCache,
  toLocalParts,
  readPrecipitation,
};
