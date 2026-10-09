const crypto = require('crypto');
const os = require('os');
const { Lock } = require('../models');

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/**
 * Try to take a lease on `name` for `ttlMs`. Returns a handle or null if someone else holds it.
 * Atomic: the upsert only matches when the lock is free or its lease has expired.
 */
const acquire = async (name, ttlMs, meta = {}) => {
  const now = new Date();
  try {
    const doc = await Lock.findOneAndUpdate(
      { _id: name, $or: [{ expiresAt: { $lte: now } }, { owner: INSTANCE_ID }] },
      { $set: { owner: INSTANCE_ID, expiresAt: new Date(now.getTime() + ttlMs), meta } },
      { upsert: true, new: true }
    ).lean();
    if (doc?.owner !== INSTANCE_ID) return null;
  } catch (err) {
    // Duplicate key = another instance holds a live lease
    if (err.code === 11000) return null;
    throw err;
  }

  return {
    name,
    renew: (extraMs = ttlMs) =>
      Lock.updateOne(
        { _id: name, owner: INSTANCE_ID },
        { $set: { expiresAt: new Date(Date.now() + extraMs) } }
      ),
    setMeta: (m) => Lock.updateOne({ _id: name, owner: INSTANCE_ID }, { $set: { meta: m } }),
    release: () => Lock.deleteOne({ _id: name, owner: INSTANCE_ID }),
  };
};

const peek = (name) => Lock.findOne({ _id: name, expiresAt: { $gt: new Date() } }).lean();

module.exports = { acquire, peek, INSTANCE_ID };
