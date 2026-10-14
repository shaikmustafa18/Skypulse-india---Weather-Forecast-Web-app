'use strict';

const express = require('express');
const config = require('../config');
const { getWeatherForCity } = require('../services/weatherService');
const { buildForecastCsv } = require('../services/csvService');
const { parseCity, parseDays } = require('../utils/validation');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/health
 * Cheap readiness probe. Reports whether an API key is configured without
 * ever revealing the key itself.
 */
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'up',
    apiKeyConfigured: Boolean(config.openWeatherApiKey),
    environment: config.nodeEnv,
    time: new Date().toISOString(),
  });
});

/**
 * GET /api/weather?city=Hyderabad
 * Resolves the city with Nominatim, then returns current weather plus the
 * 5-day forecast grouped by date.
 *
 * Every query parameter is validated here on the server — frontend validation
 * is a convenience only and is never trusted.
 */
router.get(
  '/weather',
  asyncHandler(async (req, res) => {
    const city = parseCity(req.query.city);
    const weather = await getWeatherForCity(city);

    // Weather is cached briefly server-side; let the browser reuse it too.
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.json({ ok: true, data: weather });
  })
);

/**
 * GET /api/forecast.csv?city=Hyderabad&days=3
 * Streams a downloadable CSV built on the server, containing exactly the
 * requested number of forecast dates.
 */
router.get(
  '/forecast.csv',
  asyncHandler(async (req, res) => {
    const city = parseCity(req.query.city);
    const days = parseDays(req.query.days);

    const weather = await getWeatherForCity(city);
    const { csv, filename } = buildForecastCsv(weather, days);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // The quoted filename keeps spaces and non-ASCII characters safe; the slug
    // from validation.js has already stripped anything unusual.
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
    res.status(200).send(csv);
  })
);

module.exports = router;
