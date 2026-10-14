'use strict';

const config = require('../config');

/**
 * Restrictive CORS.
 *
 * The frontend is served by this same Express app, so cross-origin access is
 * not needed by default and no CORS headers are emitted at all. Origins are
 * only allowed when explicitly listed in ALLOWED_ORIGINS — there is no
 * wildcard path, which is what "avoid unrestricted production CORS" requires.
 */
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin or non-browser client

  if (config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}

/**
 * Baseline security headers, set by hand so the project stays dependency-light.
 *
 * The CSP allows the Tailwind CDN and Google Fonts because the frontend loads
 * them; everything else is same-origin. `connect-src 'self'` means the page can
 * only call this server's own API — the browser never talks to OpenWeatherMap
 * directly, which is also why the API key never needs to reach the client.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
  );
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline'",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://openweathermap.org",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  // Express advertises itself by default; remove the fingerprint.
  res.removeHeader('X-Powered-By');
  return next();
}

module.exports = { cors, securityHeaders };
