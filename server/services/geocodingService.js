'use strict';

const config = require('../config');
const { fetchJson } = require('../utils/httpClient');
const { TtlCache } = require('../utils/cache');
const { errors } = require('../utils/AppError');
const logger = require('../utils/logger');

const SERVICE_NAME = 'The OpenStreetMap location service';

/** Successful lookups are cached for a day — city coordinates do not move. */
const geocodeCache = new TtlCache({ ttlMs: config.nominatim.cacheTtlMs, maxEntries: 500 });

/**
 * Nominatim's usage policy allows at most one request per second from an
 * application. Requests are therefore funnelled through a single promise chain
 * that spaces them out; concurrent callers queue instead of bursting.
 */
let queueTail = Promise.resolve();
let lastRequestAt = 0;

function scheduleWithRateLimit(task) {
  const run = async () => {
    const waitMs = Math.max(0, lastRequestAt + config.nominatim.minIntervalMs - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    return task();
  };
  // Chain regardless of whether the previous call resolved or rejected.
  const result = queueTail.then(run, run);
  queueTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Pick the most useful display name parts out of a Nominatim result.
 * `display_name` is a long comma-separated path; the first segment is the place
 * itself and the remaining segments are district / state / country.
 */
function describePlace(result) {
  const parts = String(result.display_name || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const address = result.address || {};
  const name =
    result.name ||
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    parts[0] ||
    'Unknown place';

  const state = address.state || (parts.length > 2 ? parts[parts.length - 2] : null);
  const country = address.country || (parts.length > 1 ? parts[parts.length - 1] : 'India');

  return {
    name,
    state: state && state !== name ? state : null,
    country,
    displayName: result.display_name || name,
  };
}

/**
 * Resolve an Indian city name to coordinates.
 *
 * @param {string} city validated, trimmed city name
 * @returns {Promise<{name,state,country,displayName,latitude,longitude,osmType,osmId,attribution,cached}>}
 */
async function geocodeCity(city) {
  const cacheKey = city.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };

  const url = new URL(config.nominatim.searchUrl);
  url.searchParams.set('q', city);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', config.nominatim.countryCodes);
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  const { status, ok, data } = await scheduleWithRateLimit(() =>
    fetchJson(url.toString(), {
      headers: {
        // Required by the Nominatim usage policy.
        'User-Agent': config.nominatim.userAgent,
        'Accept-Language': 'en',
      },
      timeoutMs: config.nominatim.timeoutMs,
      serviceName: SERVICE_NAME,
    })
  );

  if (status === 429) throw errors.rateLimited('nominatim 429');
  // A 403 means Nominatim rejected the request itself, which is almost always a
  // User-Agent that does not identify the application acceptably.
  if (status === 403) {
    logger.warn('Nominatim rejected our User-Agent', { userAgent: config.nominatim.userAgent });
    throw errors.geocodingBlocked('nominatim 403');
  }
  if (!ok) {
    logger.warn('Nominatim returned an error status', { status });
    throw errors.upstreamUnavailable(SERVICE_NAME, `status ${status}`);
  }
  if (!Array.isArray(data) || data.length === 0) throw errors.cityNotFound(city);

  const [first] = data;
  const latitude = Number.parseFloat(first.lat);
  const longitude = Number.parseFloat(first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw errors.cityNotFound(city);
  }

  const location = {
    ...describePlace(first),
    latitude,
    longitude,
    osmType: first.osm_type || null,
    osmId: first.osm_id || null,
    attribution: 'Location data © OpenStreetMap contributors (ODbL)',
  };

  geocodeCache.set(cacheKey, location);
  return { ...location, cached: false };
}

module.exports = { geocodeCity, geocodeCache, describePlace };
