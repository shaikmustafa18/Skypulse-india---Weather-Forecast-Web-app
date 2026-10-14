'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const { AppError, errors } = require('../utils/AppError');

/** 404 handler for unmatched API routes. */
function notFoundHandler(req, res, next) {
  next(errors.notFound(req.originalUrl));
}

/**
 * Central error-handling middleware.
 *
 * Only `message`, `code` and `retryable` ever reach the client. Upstream
 * details and stack traces are logged server-side; stacks are included in the
 * response body in development only, and never in production.
 */
function errorHandler(error, req, res, _next) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError('Something went wrong on our side. Please try again.', {
          status: 500,
          code: 'INTERNAL_ERROR',
          details: error?.message,
        });

  const level = appError.status >= 500 ? 'error' : 'warn';
  logger[level](`${req.method} ${req.originalUrl} -> ${appError.status} ${appError.code}`, {
    message: appError.message,
    details: appError.details,
    stack: appError.status >= 500 ? error?.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
  });

  if (res.headersSent) return; // e.g. a stream that already began writing

  res.status(appError.status).json({
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      retryable: Boolean(appError.retryable),
      ...(config.isProduction ? {} : { details: appError.details }),
    },
  });
}

/** Wrap an async route handler so rejections reach the error middleware. */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { errorHandler, notFoundHandler, asyncHandler };
