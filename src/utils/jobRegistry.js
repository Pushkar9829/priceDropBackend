const JobRun = require('../models/JobRun');
const { INSTANCE_ID } = require('./distributedLock');
const logger = require('./logger');

/**
 * Registry for long-running admin operations (keyword scrape, full refresh, retry batch).
 * Requests return a job id immediately instead of holding the HTTP connection open for minutes.
 *
 * Jobs are stored in MongoDB so any API process can report on them (multi-process / multi-instance)
 * and they survive restarts. A running job heartbeats; one whose heartbeat stops (process died)
 * is reported as failed instead of "running" forever.
 */
const HEARTBEAT_MS = 15_000;
const STALE_MS = 60_000;
const MAX_RESULT_ITEMS = 300;

const toPublic = (job) =>
  job && {
    id: String(job._id),
    type: job.type,
    label: job.label,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };

/** Running jobs whose owner stopped heartbeating are marked failed (lazily, on read). */
const reapStale = () =>
  JobRun.updateMany(
    { status: 'running', heartbeatAt: { $lt: new Date(Date.now() - STALE_MS) } },
    { $set: { status: 'failed', error: 'Interrupted (server restarted)', finishedAt: new Date() } }
  );

const trimResult = (result) => {
  if (result && Array.isArray(result.items) && result.items.length > MAX_RESULT_ITEMS) {
    return { ...result, items: result.items.slice(0, MAX_RESULT_ITEMS), itemsTruncated: result.items.length };
  }
  if (result && Array.isArray(result.results)) {
    // Per-listing results of batch refreshes are large and only summarized in the UI
    const { results, ...rest } = result;
    return { ...rest, resultCount: results.length };
  }
  return result ?? null;
};

/**
 * Start a background job. `fn` receives a `report(progress)` callback.
 * @returns {Promise<object>} public job snapshot
 */
const startJob = async (type, label, fn) => {
  const job = await JobRun.create({ type, label, owner: INSTANCE_ID });
  const heartbeat = setInterval(() => {
    JobRun.updateOne({ _id: job._id }, { $set: { heartbeatAt: new Date() } }).catch(() => {});
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let lastProgressWrite = 0;
  const report = (progress) => {
    // Throttle progress writes; the admin UI polls every ~2s anyway
    if (Date.now() - lastProgressWrite < 1500) return;
    lastProgressWrite = Date.now();
    JobRun.updateOne({ _id: job._id }, { $set: { progress, heartbeatAt: new Date() } }).catch(() => {});
  };

  Promise.resolve()
    .then(() => fn(report))
    .then((result) =>
      JobRun.updateOne({ _id: job._id }, { $set: { status: 'completed', result: trimResult(result), finishedAt: new Date() } })
    )
    .catch((err) => {
      logger.error('Background job failed', { jobId: String(job._id), type, error: err.message });
      return JobRun.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', error: err.message || String(err), finishedAt: new Date() } }
      );
    })
    .finally(() => clearInterval(heartbeat))
    .catch(() => {});

  return toPublic(job.toObject());
};

const getJob = async (id) => {
  if (!/^[a-f\d]{24}$/i.test(String(id))) return null;
  await reapStale();
  return toPublic(await JobRun.findById(id).lean());
};

const listJobs = async () => {
  await reapStale();
  return (await JobRun.find().sort({ createdAt: -1 }).limit(50).lean()).map(toPublic);
};

const hasRunning = async (type) => {
  await reapStale();
  return Boolean(await JobRun.exists({ type, status: 'running' }));
};

module.exports = { startJob, getJob, listJobs, hasRunning };
