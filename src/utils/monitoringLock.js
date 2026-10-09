/**
 * In-process per-listing lock: serializes concurrent checks of the same listing on this
 * instance (e.g. admin "refresh" while the scheduler is mid-run). Cross-instance exclusion
 * for whole runs is handled by utils/distributedLock.
 */
const perProductLocks = new Map();

const withStoreProductLock = async (storeProductId, fn) => {
  const key = String(storeProductId);

  while (perProductLocks.has(key)) {
    try {
      await perProductLocks.get(key);
    } catch {
      // previous holder rejected — continue
    }
  }

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  perProductLocks.set(key, gate);

  try {
    return await fn();
  } finally {
    perProductLocks.delete(key);
    release();
  }
};

module.exports = { withStoreProductLock };
