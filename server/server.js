"use strict";

const config = require("./config");
const logger = require("./utils/logger");
const { createApp } = require("./app");

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    `Weather Forecast App listening on http://localhost:${config.port}`,
  );
  logger.info(`Environment: ${config.nodeEnv}`);

  if (!config.openWeatherApiKey) {
    // A loud, explicit warning: the UI will otherwise fail on the first search
    // and the cause would not be obvious.
    logger.warn(
      "OPENWEATHER_API_KEY is not set. Copy .env.example to .env and add your key, " +
        "otherwise weather requests will fail with a configuration error.",
    );
  }
});

/** Fail fast with a clear message when the port is already taken. */
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      `Port ${config.port} is already in use. Set PORT in .env to a free port.`,
    );
    process.exit(1);
  }
  logger.error(`Server error: ${error.message}`);
  process.exit(1);
});

/** Give in-flight requests a chance to finish before exiting. */
function shutdown(signal) {
  logger.info(`${signal} received — shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error(
    `Unhandled promise rejection: ${reason instanceof Error ? reason.message : reason}`,
  );
});

module.exports = server;
