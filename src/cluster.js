/**
 * Production entry: one API process per CPU core (Node runs JS on a single thread, so a
 * single process saturates one core under load).
 *
 *   WEB_CONCURRENCY=4 node src/cluster.js     (default: available CPU cores, max 8)
 *
 * - Exactly one worker runs background jobs (price monitor tick, startup integrity checks);
 *   it is re-forked with the same role if it dies. Cross-instance safety still comes from the
 *   MongoDB lease lock, so several machines running this is fine too.
 * - Admin jobs live in MongoDB, so any worker can answer job status polls.
 * - Per-process rate-limit budgets are divided by the worker count so the per-IP limit stays the same.
 */
require('dotenv').config();
const cluster = require('cluster');
const os = require('os');

const workers = Math.max(
  1,
  Math.min(8, parseInt(process.env.WEB_CONCURRENCY, 10) || (os.availableParallelism ? os.availableParallelism() : os.cpus().length))
);

if (workers === 1 || !cluster.isPrimary) {
  require('./server');
} else {
  const roles = new Map(); // worker.id -> 'jobs' | 'web'
  let stopping = false;

  const fork = (role) => {
    const w = cluster.fork({ RUN_JOBS: role === 'jobs' ? '1' : '0', CLUSTER_WORKERS: String(workers) });
    roles.set(w.id, role);
  };

  for (let i = 0; i < workers; i += 1) fork(i === 0 ? 'jobs' : 'web');
  console.log(JSON.stringify({ level: 'info', message: 'Cluster started', workers, pid: process.pid }));

  cluster.on('exit', (worker, code, signal) => {
    const role = roles.get(worker.id) || 'web';
    roles.delete(worker.id);
    if (stopping) return;
    console.error(JSON.stringify({ level: 'error', message: 'Worker exited, restarting', role, code, signal }));
    setTimeout(() => fork(role), 1000);
  });

  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    for (const w of Object.values(cluster.workers)) w.process.kill(signal);
    setTimeout(() => process.exit(0), 12_000).unref();
    cluster.on('exit', () => {
      if (!Object.keys(cluster.workers).length) process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
