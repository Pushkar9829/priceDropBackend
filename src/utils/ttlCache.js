/**
 * Tiny in-process TTL cache for hot, anonymous catalog reads (search, deals, stores).
 * Prices change on a 30-min+ cadence and responses already carry Cache-Control: max-age=30,
 * so serving a ≤30s-old copy is invisible to users but removes repeated heavy queries
 * when many visitors hit the same pages at once.
 *
 * Concurrent misses for the same key share one in-flight promise (no thundering herd).
 */
const createTtlCache = ({ ttlMs = 30_000, max = 500 } = {}) => {
  const store = new Map();

  const get = (key, loader) => {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expires > now) return hit.promise;

    const promise = Promise.resolve().then(loader);
    store.set(key, { promise, expires: now + ttlMs });
    // Failed loads are not cached
    promise.catch(() => {
      if (store.get(key)?.promise === promise) store.delete(key);
    });
    // Evict oldest entries (Map keeps insertion order)
    while (store.size > max) store.delete(store.keys().next().value);
    return promise;
  };

  const clear = () => store.clear();
  return { get, clear };
};

module.exports = { createTtlCache };
