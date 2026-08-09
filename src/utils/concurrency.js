/**
 * Simple controlled concurrency pool (no Redis/BullMQ needed for V1).
 */
const runWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let index = 0;

  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = { error: err };
      }
    }
  });

  await Promise.all(runners);
  return results;
};

module.exports = { runWithConcurrency };
