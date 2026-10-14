'use strict';

/**
 * Minimal in-memory TTL cache with a bounded size.
 *
 * Used to satisfy two different requirements: the Nominatim usage policy asks
 * that identical geocoding lookups be cached, and weather responses are cached
 * briefly so repeated searches for the same city do not spend API quota.
 *
 * Entries expire lazily on read; the oldest entry is evicted when the cache is
 * full, which keeps memory flat without a background timer.
 */
class TtlCache {
  constructor({ ttlMs, maxEntries = 500 } = {}) {
    if (!ttlMs) throw new Error('TtlCache requires a ttlMs');
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh insertion order so hot keys survive eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

module.exports = { TtlCache };
