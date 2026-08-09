require('dotenv').config();
const connectDB = require('../src/config/db');
const { StoreProduct, PriceHistory } = require('../src/models');
const { recordPriceChange } = require('../src/services/priceChangeRecorder');

(async () => {
  await connectDB();
  const listings = await StoreProduct.find({
    isActive: true,
    currentPrice: { $gt: 0 },
  });
  let created = 0;
  let skipped = 0;
  for (const sp of listings) {
    const exists = await PriceHistory.exists({ storeProductId: sp._id });
    if (exists) {
      skipped += 1;
      continue;
    }
    await recordPriceChange({
      storeProduct: sp,
      previousPrice: null,
      newPrice: sp.currentPrice,
      priceChanged: true,
      newAvailability: sp.availability || 'UNKNOWN',
    });
    created += 1;
  }
  console.log(JSON.stringify({ listings: listings.length, historyCreated: created, skipped }));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
