'use strict';

/**
 * Application error carrying an HTTP status plus a short machine-readable code.
 *
 * Everything the user ever sees comes from `message`, so messages are written
 * in plain language. Upstream details (provider response bodies, stack traces,
 * API keys) are kept in `details`, which is logged server-side but never sent
 * to the client.
 */
class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details, retryable = false } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    Error.captureStackTrace?.(this, AppError);
  }
}

/** Common error factories, so wording stays consistent across services. */
const errors = {
  emptyCity: () =>
    new AppError('Please enter a city name to search.', {
      status: 400,
      code: 'EMPTY_CITY',
    }),

  invalidCity: (reason) =>
    new AppError(reason || 'That city name does not look valid. Please use letters, spaces or hyphens.', {
      status: 400,
      code: 'INVALID_CITY',
    }),

  cityNotFound: (city) =>
    new AppError(
      `We could not find "${city}" in India. Please check the spelling or try a nearby larger city.`,
      { status: 404, code: 'CITY_NOT_FOUND' }
    ),

  invalidDays: () =>
    new AppError('Forecast duration must be a whole number between 1 and 5 days.', {
      status: 400,
      code: 'INVALID_DAYS',
    }),

  missingApiKey: () =>
    new AppError(
      'The weather service is not configured yet. The server is missing its OpenWeatherMap API key.',
      { status: 500, code: 'MISSING_API_KEY' }
    ),

  invalidApiKey: (details) =>
    new AppError(
      'The weather service rejected our API key. Please check the OPENWEATHER_API_KEY setting.',
      { status: 502, code: 'INVALID_API_KEY', details }
    ),

  rateLimited: (details) =>
    new AppError(
      'The weather service is receiving too many requests right now. Please wait a moment and try again.',
      { status: 429, code: 'UPSTREAM_RATE_LIMITED', details, retryable: true }
    ),

  geocodingBlocked: (details) =>
    new AppError(
      'The OpenStreetMap location service refused our request. The server needs a ' +
        'NOMINATIM_USER_AGENT that identifies this app with a real contact URL or email ' +
        '(placeholder example.com addresses are blocked).',
      { status: 502, code: 'GEOCODING_BLOCKED', details }
    ),

  upstreamUnavailable: (service, details) =>
    new AppError(
      `${service} is temporarily unavailable. Please try again in a few moments.`,
      { status: 503, code: 'UPSTREAM_UNAVAILABLE', details, retryable: true }
    ),

  timeout: (service) =>
    new AppError(`${service} took too long to respond. Please try again.`, {
      status: 504,
      code: 'UPSTREAM_TIMEOUT',
      retryable: true,
    }),

  network: (service, details) =>
    new AppError(
      `We could not reach ${service}. Please check the server's internet connection and try again.`,
      { status: 503, code: 'NETWORK_ERROR', details, retryable: true }
    ),

  forecastUnavailable: () =>
    new AppError('Forecast data is not available for this location right now.', {
      status: 502,
      code: 'FORECAST_UNAVAILABLE',
      retryable: true,
    }),

  csvFailed: (details) =>
    new AppError('We could not build the CSV export. Please try again.', {
      status: 500,
      code: 'CSV_FAILED',
      details,
    }),

  tooManyRequests: (retryAfterSeconds) =>
    new AppError(
      `You are sending requests a little too quickly. Please wait ${retryAfterSeconds} seconds and try again.`,
      { status: 429, code: 'RATE_LIMITED', retryable: true }
    ),

  notFound: (path) =>
    new AppError(`No route matches ${path}.`, { status: 404, code: 'ROUTE_NOT_FOUND' }),
};

module.exports = { AppError, errors };
