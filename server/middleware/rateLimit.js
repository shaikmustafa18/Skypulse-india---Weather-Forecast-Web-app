'use strict';

const config = require('../config');
const { errors } = require('../utils/AppError');

/**
 * Fixed-window, per-IP rate limiter.
 *
 * Deliberately dependency-free and in-memory: it protects the single-process
 * dev/demo server from a runaway client exhausting the upstream API quota. A
 * multi-instance deployment would need a shared store (Redis) instead.
 */
function createRateLimiter({
  windowMs = config.rateLimit.windowMs,
  maxRequests = config.rateLimit.maxRequests,
} = {}) {
  const hits = new Map(); // ip -> { count, windowStart }

  // Drop stale buckets periodically so memory does not grow with unique IPs.
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, bucket] of hits) {
      if (bucket.windowStart <= cutoff) hits.delete(ip);
    }
  }, windowMs).unref();

  function middleware(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = hits.get(ip);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return next(errors.tooManyRequests(retryAfter));
    }

    return next();
  }

  middleware.reset = () => hits.clear();
  middleware.stop = () => clearInterval(sweeper);
  return middleware;
}

module.exports = { createRateLimiter };
