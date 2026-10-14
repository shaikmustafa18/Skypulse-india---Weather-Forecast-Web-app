'use strict';

const { AppError, errors } = require('./AppError');

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fetch JSON with a hard timeout and uniform error translation.
 *
 * Node's global fetch never times out on its own, so every outbound request is
 * bounded by an AbortController. Upstream failures are converted into AppError
 * instances here, which keeps provider-specific handling out of the services.
 *
 * @param {string} url            absolute URL to request
 * @param {object} [options]
 * @param {object} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.serviceName] human-readable name used in messages
 * @returns {Promise<{ status: number, data: any }>}
 */
async function fetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, serviceName = 'The weather service' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    // AbortError means our own timeout fired; anything else is DNS/TCP/TLS.
    if (error?.name === 'AbortError') throw errors.timeout(serviceName);
    throw errors.network(serviceName, error?.message);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body on an error status is normal (HTML error pages, proxies).
    if (!response.ok) {
      throw errors.upstreamUnavailable(serviceName, `non-JSON ${response.status} body`);
    }
    throw new AppError(`${serviceName} returned a response we could not read.`, {
      status: 502,
      code: 'BAD_UPSTREAM_PAYLOAD',
      details: text.slice(0, 200),
      retryable: true,
    });
  }

  return { status: response.status, ok: response.ok, data };
}

module.exports = { fetchJson, DEFAULT_TIMEOUT_MS };
