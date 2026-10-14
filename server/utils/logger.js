'use strict';

/**
 * Tiny timestamped logger. Kept separate so request logging and error logging
 * share one format, and so secrets can be scrubbed in a single place.
 */
const SECRET_PATTERN = /(appid|api[-_]?key|token)=([^&\s]+)/gi;

/** Replace API keys in any string before it reaches the logs. */
function redact(value) {
  if (typeof value !== 'string') return value;
  return value.replace(SECRET_PATTERN, '$1=***redacted***');
}

function write(level, message, meta) {
  const line = `${new Date().toISOString()} [${level}] ${redact(message)}`;
  const payload = meta === undefined ? '' : ` ${redact(JSON.stringify(meta))}`;
  const stream = level === 'error' ? console.error : console.log;
  stream(`${line}${payload}`);
}

module.exports = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  redact,
};
