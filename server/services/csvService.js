'use strict';

const { errors } = require('../utils/AppError');
const { toFilenameSlug } = require('../utils/validation');

/** Excel needs a UTF-8 byte-order mark to read "°C" and city names correctly. */
const UTF8_BOM = '﻿';

/** Spreadsheet applications are most reliable with CRLF line endings (RFC 4180). */
const LINE_BREAK = '\r\n';

const COLUMNS = [
  'Date',
  'Day',
  'Min Temp (C)',
  'Max Temp (C)',
  'Avg Temp (C)',
  'Humidity (%)',
  'Precipitation (mm)',
  'Precipitation Chance (%)',
  'Avg Wind Speed (m/s)',
  'Condition',
  'Description',
  'Forecast Intervals',
];

/**
 * Escape one CSV field per RFC 4180.
 *
 * A field is quoted when it contains a comma, quote, newline or leading/
 * trailing space; embedded quotes are doubled. A leading =, +, - or @ is also
 * prefixed with a single quote, because spreadsheet applications would
 * otherwise treat the value as a formula (CSV injection).
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  const needsQuoting = /[",\r\n]/.test(text) || text !== text.trim();
  if (!needsQuoting) return text;

  return `"${text.replace(/"/g, '""')}"`;
}

/** Join one row of already-raw values into an escaped CSV line. */
function toCsvRow(values) {
  return values.map(escapeCsvField).join(',');
}

/**
 * Values that the API did not report are written as "N/A" rather than as 0, so
 * nobody reading the spreadsheet mistakes missing data for a real measurement.
 */
function orNA(value) {
  return value === null || value === undefined ? 'N/A' : value;
}

/**
 * Build the forecast CSV for a weather payload.
 *
 * @param {object} weather payload from weatherService.getWeatherForCity
 * @param {number} days    how many forecast days to include (1–5, validated)
 * @returns {{ csv: string, filename: string, rowCount: number }}
 */
function buildForecastCsv(weather, days) {
  try {
    const allDays = weather?.forecast?.days;
    if (!Array.isArray(allDays) || allDays.length === 0) throw errors.forecastUnavailable();

    // Only the requested number of dates is exported — never more, never other
    // dates than the ones the user is looking at in the UI.
    const selected = allDays.slice(0, days);
    if (selected.length === 0) throw errors.forecastUnavailable();

    const location = weather.location || {};
    const locationLabel = [location.name, location.state, location.country]
      .filter(Boolean)
      .join(', ');

    const lines = [];

    // A short metadata preamble makes an exported file self-describing.
    lines.push(toCsvRow(['Weather Forecast Export']));
    lines.push(toCsvRow(['Location', locationLabel || weather.query || 'Unknown']));
    lines.push(
      toCsvRow([
        'Coordinates',
        `${Number(location.latitude).toFixed(4)}, ${Number(location.longitude).toFixed(4)}`,
      ])
    );
    lines.push(toCsvRow(['Forecast Days', selected.length]));
    lines.push(toCsvRow(['Generated At (UTC)', new Date().toISOString()]));
    lines.push(toCsvRow(['Units', 'Temperature °C, Wind m/s, Precipitation mm']));
    lines.push(toCsvRow(['Source', 'OpenWeatherMap 5 day / 3 hour forecast']));
    lines.push(toCsvRow(['Geocoding', 'OpenStreetMap Nominatim, © OpenStreetMap contributors']));
    lines.push(
      toCsvRow([
        'Note',
        'Daily values are calculated from the available 3-hour forecast intervals; the first and last days may be partial. N/A means the API did not report that value.',
      ])
    );
    lines.push(''); // blank separator row before the table header

    lines.push(toCsvRow(COLUMNS));

    for (const day of selected) {
      lines.push(
        toCsvRow([
          day.date,
          day.weekday,
          orNA(day.tempMin),
          orNA(day.tempMax),
          orNA(day.tempAvg),
          orNA(day.humidity),
          orNA(day.precipitationMm),
          orNA(day.precipitationChance),
          orNA(day.windSpeedAvg),
          orNA(day.condition?.main),
          orNA(day.condition?.description),
          orNA(day.intervals),
        ])
      );
    }

    const citySlug = toFilenameSlug(location.name || weather.query || 'city');

    return {
      csv: `${UTF8_BOM}${lines.join(LINE_BREAK)}${LINE_BREAK}`,
      filename: `${citySlug}-weather-forecast.csv`,
      rowCount: selected.length,
    };
  } catch (error) {
    if (error?.name === 'AppError') throw error;
    throw errors.csvFailed(error?.message);
  }
}

module.exports = { buildForecastCsv, escapeCsvField, toCsvRow, COLUMNS, UTF8_BOM };
