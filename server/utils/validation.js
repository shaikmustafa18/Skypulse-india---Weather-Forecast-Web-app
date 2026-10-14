'use strict';

const { errors } = require('./AppError');

const MIN_CITY_LENGTH = 2;
const MAX_CITY_LENGTH = 60;

/**
 * City names in India legitimately contain spaces, hyphens, apostrophes and
 * dots (e.g. "Thiruvananthapuram", "Navi Mumbai", "Puducherry", "St. Thomas
 * Mount"). Unicode letters are allowed so Devanagari / Telugu input also works.
 */
const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’()-]*$/u;

const MIN_DAYS = 1;
const MAX_DAYS = 5;

/**
 * Validate and normalise the `city` query parameter.
 * @returns {string} trimmed, whitespace-collapsed city name
 */
function parseCity(rawValue) {
  if (rawValue === undefined || rawValue === null) throw errors.emptyCity();
  // Express gives an array when a parameter repeats (?city=a&city=b).
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') throw errors.invalidCity();

  const city = value.trim().replace(/\s+/g, ' ');
  if (city.length === 0) throw errors.emptyCity();
  if (city.length < MIN_CITY_LENGTH) {
    throw errors.invalidCity('Please enter at least 2 characters.');
  }
  if (city.length > MAX_CITY_LENGTH) {
    throw errors.invalidCity(`City names cannot be longer than ${MAX_CITY_LENGTH} characters.`);
  }
  if (!CITY_PATTERN.test(city)) {
    throw errors.invalidCity('Please use letters, spaces, hyphens or apostrophes only.');
  }
  return city;
}

/**
 * Validate the `days` query parameter. Defaults to 5 when absent.
 * Rejects decimals, non-numbers and anything outside 1–5.
 * @returns {number} integer between 1 and 5
 */
function parseDays(rawValue, { defaultValue = MAX_DAYS } = {}) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return defaultValue;
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string' && typeof value !== 'number') throw errors.invalidDays();

  const asString = String(value).trim();
  if (!/^\d+$/.test(asString)) throw errors.invalidDays();

  const days = Number.parseInt(asString, 10);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) throw errors.invalidDays();
  return days;
}

/** Make a city name safe for use inside a download filename. */
function toFilenameSlug(city) {
  const slug = city
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'city';
}

module.exports = { parseCity, parseDays, toFilenameSlug, MIN_DAYS, MAX_DAYS, MAX_CITY_LENGTH };
