/**
 * In-process locks for price monitoring.
 * Prevents overlapping cron + admin refresh on the same store products.
 */

let batchRunning = false;

const perProductLocks = new Map();

const tryAcquireBatchLock = () => {
  if (batchRunning) return false;
  batchRunning = true;
  return true;
};

const releaseBatchLock = () => {
  batchRunning = false;
};

const isBatchRunning = () => batchRunning;

/**
 * Serialize checks for the same storeProductId across concurrent callers.
 */
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

module.exports = {
  tryAcquireBatchLock,
  releaseBatchLock,
  isBatchRunning,
  withStoreProductLock,
};
