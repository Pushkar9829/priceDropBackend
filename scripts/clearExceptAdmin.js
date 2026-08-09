/**
 * Wipe all app data except the admin user, then recreate stores + brand catalog.
 * Usage: node scripts/clearExceptAdmin.js
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const {
  User,
  Store,
  INTEGRATION_TYPES,
  Product,
  StoreProduct,
  PriceHistory,
  Watchlist,
  PriceAlert,
  Notification,
  Deal,
  Brand,
} = require('../src/models');
const { STORE_LOGOS } = require('../src/integrations/demo/demoCatalog');
const { upsertBrandCatalog } = require('../src/utils/seedBrands');
const logger = require('../src/utils/logger');

const run = async () => {
  await connectDB();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@pricecompare.local';
  const admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    throw new Error(`Admin not found: ${adminEmail}`);
  }

  const removedUsers = await User.deleteMany({ _id: { $ne: admin._id } });
  logger.info('Kept admin user', { email: admin.email, id: String(admin._id) });
  logger.info('Removed other users', { count: removedUsers.deletedCount });

  const collections = [
    ['products', Product],
    ['storeProducts', StoreProduct],
    ['priceHistory', PriceHistory],
    ['deals', Deal],
    ['watchlists', Watchlist],
    ['priceAlerts', PriceAlert],
    ['notifications', Notification],
    ['brands', Brand],
    ['stores', Store],
  ];

  for (const [name, Model] of collections) {
    const r = await Model.deleteMany({});
    logger.info('Cleared collection', { name, deleted: r.deletedCount });
  }

  const storeDefs = [
    {
      name: 'Amazon',
      slug: 'amazon',
      domain: 'amazon.in',
      logo: STORE_LOGOS.amazon,
      integrationType: INTEGRATION_TYPES.PLAYWRIGHT,
    },
    {
      name: 'Flipkart',
      slug: 'flipkart',
      domain: 'flipkart.com',
      logo: STORE_LOGOS.flipkart,
      integrationType: INTEGRATION_TYPES.PLAYWRIGHT,
    },
    {
      name: 'Myntra',
      slug: 'myntra',
      domain: 'myntra.com',
      logo: STORE_LOGOS.myntra,
      integrationType: INTEGRATION_TYPES.DEMO_FEED,
    },
    {
      name: 'Croma',
      slug: 'croma',
      domain: 'croma.com',
      logo: STORE_LOGOS.croma,
      integrationType: INTEGRATION_TYPES.PLAYWRIGHT,
    },
  ];

  for (const def of storeDefs) {
    await Store.create({ ...def, isActive: true });
  }
  logger.info('Recreated stores', { slugs: storeDefs.map((s) => s.slug) });

  const brands = await upsertBrandCatalog();
  logger.info('Brand catalog ready', brands);

  console.log(
    JSON.stringify(
      {
        admin: { email: admin.email, id: String(admin._id) },
        usersLeft: await User.countDocuments(),
        stores: await Store.countDocuments(),
        brands: await Brand.countDocuments(),
        products: await Product.countDocuments(),
      },
      null,
      2
    )
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
    process.exit(process.exitCode || 0);
  });
