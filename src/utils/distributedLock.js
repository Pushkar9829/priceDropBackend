const crypto = require('crypto');
const os = require('os');
const { Lock } = require('../models');

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;

/**
 * Try to take a lease on `name` for `ttlMs`. Returns a handle or null if someone holds it.
 * Atomic: the upsert only matches when the lease has expired (or the lock doc is absent).
 * Each acquisition gets its own owner token, so a second run in the SAME process can't
 * re-take a live lease, and one run's release() can never delete another run's lock.
 */
const acquire = async (name, ttlMs, meta = {}) => {
  const now = new Date();
  const owner = `${INSTANCE_ID}:${crypto.randomBytes(4).toString('hex')}`;
  try {
    const doc = await Lock.findOneAndUpdate(
      { _id: name, expiresAt: { $lte: now } },
      { $set: { owner, expiresAt: new Date(now.getTime() + ttlMs), meta } },
      { upsert: true, new: true }
    ).lean();
    if (doc?.owner !== owner) return null;
  } catch (err) {
    // Duplicate key = another holder has a live lease
    if (err.code === 11000) return null;
    throw err;
  }

  return {
    name,
    owner,
    renew: (extraMs = ttlMs) =>
      Lock.updateOne({ _id: name, owner }, { $set: { expiresAt: new Date(Date.now() + extraMs) } }),
    setMeta: (m) => Lock.updateOne({ _id: name, owner }, { $set: { meta: m } }),
    release: () => Lock.deleteOne({ _id: name, owner }),
  };
};

const peek = (name) => Lock.findOne({ _id: name, expiresAt: { $gt: new Date() } }).lean();

module.exports = { acquire, peek, INSTANCE_ID };
