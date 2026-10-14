"use strict";

const path = require("path");
const express = require("express");
const config = require("./config");
const apiRouter = require("./routes/api");
const logger = require("./utils/logger");
const { cors, securityHeaders } = require("./middleware/security");
const { createRateLimiter } = require("./middleware/rateLimit");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

/**
 * Build the Express application.
 *
 * Kept separate from server.js so tests can mount the app without binding a
 * port. Middleware order matters: security headers and CORS first, then the
 * rate limiter on /api, then routes, then the 404 and error handlers last.
 */
function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Needed for correct req.ip behind a single reverse proxy (e.g. nginx).
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(cors);

  // Lightweight request log; the logger redacts any API key in the URL.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      logger.info(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`,
      );
    });
    next();
  });

  // Rate limiting applies to the API only, not to static assets.
  app.use("/api", createRateLimiter());
  app.use("/api", apiRouter);

  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ["html"],
      maxAge: config.isProduction ? "1h" : 0,
    }),
  );

  // Single-page entry point for any non-API GET that is not a static file.
  app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, PUBLIC_DIR };
