/**
 * Refuse to run destructive maintenance scripts against a non-local or production database
 * unless the operator explicitly passes --force.
 */
const assertSafeTarget = (scriptName) => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/price_comparison';
  const isLocal = /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(uri) || /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(uri);
  const isProd = process.env.NODE_ENV === 'production';
  if ((isProd || !isLocal) && !process.argv.includes('--force')) {
    console.error(
      `[${scriptName}] Refusing to run: it deletes/rewrites data and the target is ${isProd ? 'NODE_ENV=production' : 'not a local database'}.\n` +
        `Re-run with --force only if you are sure.`
    );
    process.exit(1);
  }
};

module.exports = { assertSafeTarget };
