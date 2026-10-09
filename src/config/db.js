const dns = require('dns');
const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

// Some Windows/ISP resolvers fail MongoDB SRV lookups for Atlas. This changes DNS for the
// whole process (SMTP, scraping), so only do it in development or when explicitly asked.
const dnsOverride = process.env.MONGODB_DNS_SERVERS || (config.env !== 'production' ? '8.8.8.8,1.1.1.1' : '');
if (dnsOverride && String(config.mongodbUri || '').includes('mongodb+srv://')) {
  dns.setServers(dnsOverride.split(',').map((x) => x.trim()).filter(Boolean));
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
