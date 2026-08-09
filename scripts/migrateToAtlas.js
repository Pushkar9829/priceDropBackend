/**
 * One-shot: copy all collections from local MongoDB → Atlas.
 * Usage: node scripts/migrateToAtlas.js
 *
 * Env (optional overrides):
 *   SOURCE_URI  default local price_comparison
 *   TARGET_URI  Atlas connection string
 */
require('dotenv').config();

const dns = require('dns');
// Some Windows/ISP resolvers refuse MongoDB SRV lookups
dns.setServers(['8.8.8.8', '1.1.1.1']);

const { MongoClient } = require('mongodb');

const SOURCE_URI =
  process.env.SOURCE_URI || 'mongodb://127.0.0.1:27017/price_comparison';
const TARGET_URI = process.env.TARGET_URI;

if (!TARGET_URI) {
  console.error('Set TARGET_URI to your Atlas mongodb+srv://... connection string');
  process.exit(1);
}

const BATCH = 500;

async function copyCollection(sourceDb, targetDb, name) {
  const source = sourceDb.collection(name);
  const target = targetDb.collection(name);
  const total = await source.countDocuments();
  if (total === 0) {
    console.log(`  skip ${name} (empty)`);
    return { name, copied: 0 };
  }

  await target.deleteMany({});
  let copied = 0;
  const cursor = source.find({}).batchSize(BATCH);

  let batch = [];
  while (await cursor.hasNext()) {
    batch.push(await cursor.next());
    if (batch.length >= BATCH) {
      await target.insertMany(batch, { ordered: false });
      copied += batch.length;
      process.stdout.write(`\r  ${name}: ${copied}/${total}`);
      batch = [];
    }
  }
  if (batch.length) {
    await target.insertMany(batch, { ordered: false });
    copied += batch.length;
  }
  console.log(`\r  ${name}: ${copied}/${total} done`);
  return { name, copied };
}

async function main() {
  console.log('Source:', SOURCE_URI.replace(/\/\/.*@/, '//***@'));
  console.log('Target:', TARGET_URI.replace(/\/\/.*:.*@/, '//***:***@'));

  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_URI);

  await sourceClient.connect();
  await targetClient.connect();
  console.log('Connected to both databases');

  const sourceDb = sourceClient.db();
  const targetDb = targetClient.db();

  const collections = (await sourceDb.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  console.log('Collections:', collections.join(', '));

  const summary = [];
  for (const name of collections) {
    try {
      summary.push(await copyCollection(sourceDb, targetDb, name));
    } catch (err) {
      console.error(`\n  FAILED ${name}:`, err.message);
      summary.push({ name, copied: 0, error: err.message });
    }
  }

  console.log('\nSummary:');
  for (const row of summary) {
    console.log(`  ${row.name}: ${row.copied}${row.error ? ` ERROR ${row.error}` : ''}`);
  }

  await sourceClient.close();
  await targetClient.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
