const dns = require('dns');
const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

// Windows/ISP DNS often fails MongoDB SRV lookups for Atlas
if (String(config.mongodbUri || '').includes('mongodb+srv://')) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongodbUri);
    logger.info('MongoDB connected', { host: conn.connection.host, db: conn.connection.name });
  } catch (error) {
    logger.error('MongoDB connection failed', { error: error.message });
    process.exit(1);
  }
};

module.exports = connectDB;
