"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  get isProduction() {
    return this.nodeEnv === "production";
  },

  // Secret: read on the server only, never serialised to a client response.
  openWeatherApiKey: (process.env.OPENWEATHER_API_KEY || "").trim(),

  openWeather: {
    currentUrl: "https://api.openweathermap.org/data/2.5/weather",
    forecastUrl: "https://api.openweathermap.org/data/2.5/forecast",
    units: "metric", // all temperatures therefore arrive in Celsius
    timeoutMs: toInt(process.env.OPENWEATHER_TIMEOUT_MS, 8000),
    cacheTtlMs: toInt(process.env.WEATHER_CACHE_TTL_MS, 10 * 60 * 1000), // 10 minutes
  },

  nominatim: {
    searchUrl: "https://nominatim.openstreetmap.org/search",
    // The Nominatim usage policy requires an identifiable User-Agent.
    userAgent:
      process.env.NOMINATIM_USER_AGENT ||
      "SkyPulseIndia/1.0 (weather forecast app; https://github.com/your-username/weather-forecast-app)",
    timeoutMs: toInt(process.env.NOMINATIM_TIMEOUT_MS, 8000),
    cacheTtlMs: toInt(process.env.GEOCODE_CACHE_TTL_MS, 24 * 60 * 60 * 1000), // 24 hours
    minIntervalMs: toInt(process.env.NOMINATIM_MIN_INTERVAL_MS, 1100), // policy: max 1 req/sec
    countryCodes: "in", // searches are restricted to India
  },

  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    maxRequests: toInt(process.env.RATE_LIMIT_MAX, 60),
  },

  // Empty list => same-origin only (no CORS headers emitted at all).
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

module.exports = config;
