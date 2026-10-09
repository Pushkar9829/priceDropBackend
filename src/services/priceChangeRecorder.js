const logger = require('../utils/logger');
const { calcPercentageChange, calcPriceDifference, round2 } = require('../utils/helpers');
const config = require('../config');
const { PriceHistory, Deal, StoreProduct } = require('../models');
const { isValidPrice } = require('../integrations/stores/base/validator');
const alertService = require('./alertService');
const { refreshProductSummaries } = require('./productSummaryService');

const DEAL_SEVERITIES = ['SIGNIFICANT', 'MAJOR', 'HISTORICAL_LOW'];

/**
 * Classify price change and drop severity.
 */
const analyzePriceChange = (previousPrice, newPrice, historicalLowest) => {
  if (previousPrice == null) {
    return {
      changeType: 'INITIAL',
      priceDifference: null,
      percentageChange: null,
      dropSeverity: 'NONE',
      isHistoricalLow: historicalLowest == null || newPrice <= historicalLowest,
    };
  }

  const priceDifference = calcPriceDifference(previousPrice, newPrice);
  const percentageChange = calcPercentageChange(previousPrice, newPrice);

  let changeType = 'UNCHANGED';
  if (priceDifference < 0) changeType = 'DECREASE';
  else if (priceDifference > 0) changeType = 'INCREASE';

  let dropSeverity = 'NONE';
  // Strictly below the previous all-time low — matching it again isn't news
  const isHistoricalLow = changeType === 'DECREASE' && (historicalLowest == null || newPrice < historicalLowest);

  if (changeType === 'DECREASE') {
    const absPct = Math.abs(percentageChange || 0);
    if (isHistoricalLow && absPct >= 1) dropSeverity = 'HISTORICAL_LOW';
    else if (absPct >= config.priceDrop.majorPercent) dropSeverity = 'MAJOR';
    else if (absPct >= config.priceDrop.significantPercent) dropSeverity = 'SIGNIFICANT';
    else dropSeverity = 'NORMAL';
  }

  return { changeType, priceDifference, percentageChange, dropSeverity, isHistoricalLow };
};

/** All-time low for a listing: stored on the listing, history scan only as a fallback. */
const getHistoricalLowest = async (storeProduct) => {
  if (storeProduct.lowestEverPrice != null) return storeProduct.lowestEverPrice;
  const result = await PriceHistory.findOne({ storeProductId: storeProduct._id, newPrice: { $gt: 0 } })
    .sort({ newPrice: 1 })
    .select('newPrice')
    .lean();
  return result?.newPrice ?? null;
};

/**
 * Keep the listing's deal in step with its price:
 *  - big drop            → create/refresh deal (discount measured from the pre-drop price)
 *  - price rises / OOS   → deal deactivated once it's no longer a real saving
 */
const syncDeal = async ({ storeProduct, analysis, previousPrice, newPrice, newAvailability }) => {
  const active = await Deal.findOne({ storeProductId: storeProduct._id, isActive: true });

  if (newAvailability === 'OUT_OF_STOCK') {
    if (active) await Deal.updateOne({ _id: active._id }, { $set: { isActive: false } });
    return;
  }

  if (analysis?.changeType === 'DECREASE' && DEAL_SEVERITIES.includes(analysis.dropSeverity)) {
    // Consecutive drops extend one deal; the reference price stays the original pre-drop price
    const reference = active?.previousPrice && active.previousPrice > newPrice ? active.previousPrice : previousPrice;
    const pct = round2(((reference - newPrice) / reference) * 100);
    const upsertDeal = () => Deal.findOneAndUpdate(
      { storeProductId: storeProduct._id, isActive: true },
      {
        $set: {
          productId: storeProduct.productId,
          storeId: storeProduct.storeId,
          title: `Price drop: ${storeProduct.title}`,
          description: `Price dropped from ₹${reference} to ₹${newPrice} (${Math.round(pct)}% off)`,
          previousPrice: reference,
          currentPrice: newPrice,
          discountPercent: pct,
          dropSeverity: analysis.dropSeverity,
          isHistoricalLow: analysis.isHistoricalLow,
          isActive: true,
          expiresAt: new Date(Date.now() + config.monitor.dealTtlDays * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true }
    );
    try {
      await upsertDeal();
    } catch (err) {
      // Concurrent upsert lost the race on the one-active-deal index → update the winner
      if (err.code !== 11000) throw err;
      await upsertDeal();
    }
    return;
  }

  if (active && newPrice !== active.currentPrice) {
    const pct = active.previousPrice ? ((active.previousPrice - newPrice) / active.previousPrice) * 100 : 0;
    if (pct < config.priceDrop.significantPercent) {
      await Deal.updateOne({ _id: active._id }, { $set: { isActive: false, currentPrice: newPrice } });
      logger.info('Deal ended — price recovered', { dealId: active._id, newPrice });
    } else {
      await Deal.updateOne({ _id: active._id }, { $set: { currentPrice: newPrice, discountPercent: round2(pct) } });
    }
  }
};

/**
 * Record a price / availability change: history → listing extremes → deal → product summary → alerts.
 * Caller must already have saved the new price/availability on the StoreProduct.
 */
const recordPriceChange = async ({
  storeProduct,
  previousPrice,
  newPrice,
  priceChanged,
  availabilityChanged = false,
  newAvailability,
}) => {
  if (!priceChanged && !availabilityChanged) {
    return { analysis: null, historyRecord: null };
  }

  const historicalLowest = await getHistoricalLowest(storeProduct);
  const analysis = analyzePriceChange(priceChanged ? previousPrice : newPrice, newPrice, historicalLowest);
  if (!priceChanged) analysis.changeType = 'AVAILABILITY_CHANGE';

  const availability = newAvailability || storeProduct.availability || 'UNKNOWN';
  const historyRecord = await PriceHistory.create({
    productId: storeProduct.productId,
    storeProductId: storeProduct._id,
    storeId: storeProduct.storeId,
    previousPrice: priceChanged ? previousPrice : newPrice,
    newPrice,
    priceDifference: priceChanged ? analysis.priceDifference : 0,
    percentageChange: priceChanged ? analysis.percentageChange : 0,
    availability,
    changeType: analysis.changeType,
    isHistoricalLow: priceChanged ? analysis.isHistoricalLow : false,
    dropSeverity: priceChanged ? analysis.dropSeverity : 'NONE',
    recordedAt: new Date(),
  });

  if (isValidPrice(newPrice)) {
    // Pipeline update: plain $min would keep a stored null (null sorts below numbers)
    await StoreProduct.updateOne(
      { _id: storeProduct._id },
      [
        {
          $set: {
            lowestEverPrice: { $min: [{ $ifNull: ['$lowestEverPrice', newPrice] }, newPrice] },
            highestEverPrice: { $max: [{ $ifNull: ['$highestEverPrice', newPrice] }, newPrice] },
          },
        },
      ],
      { timestamps: false }
    );
    storeProduct.lowestEverPrice = Math.min(storeProduct.lowestEverPrice ?? newPrice, newPrice);
  }

  if (priceChanged && previousPrice != null) {
    logger.info(analysis.changeType === 'DECREASE' ? 'Price decreased' : 'Price increased', {
      storeProductId: storeProduct._id,
      previousPrice,
      newPrice,
      percentageChange: analysis.percentageChange,
      dropSeverity: analysis.dropSeverity,
      historicalLow: analysis.isHistoricalLow || undefined,
    });
  } else if (availabilityChanged) {
    logger.info('Availability changed', { storeProductId: storeProduct._id, availability });
  }

  try {
    await syncDeal({ storeProduct, analysis, previousPrice, newPrice, newAvailability: availability });
  } catch (err) {
    logger.error('Deal sync failed', { storeProductId: storeProduct._id, error: err.message });
  }

  // Summary first: "any store" alerts compare against the product's new lowest price
  await refreshProductSummaries([storeProduct.productId]);

  try {
    await alertService.evaluateAlertsForProduct(storeProduct.productId, {
      changedStoreProductId: storeProduct._id,
      previousPrice: priceChanged ? previousPrice : null,
    });
  } catch (err) {
    logger.error('Alert evaluation failed', { productId: storeProduct.productId, error: err.message });
  }

  return { analysis, historyRecord };
};

/**
 * Apply a newly fetched price onto a StoreProduct and record side effects.
 * Used by search/import upserts when the listing already exists.
 */
const applyFetchedPrice = async (
  storeProduct,
  { newPrice, mrp, availability, title, productUrl, images, rating, reviewCount, seller }
) => {
  const previousPrice = storeProduct.currentPrice;
  const previousAvailability = storeProduct.availability;
  const newAvailability = availability || previousAvailability || 'UNKNOWN';
  const priceChanged = previousPrice !== newPrice;
  const availabilityChanged = previousAvailability !== newAvailability;

  const now = new Date();
  storeProduct.lastCheckedAt = now;
  storeProduct.lastSuccessfulFetchAt = now;
  storeProduct.scrapeStatus = newAvailability === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'SUCCESS';
  storeProduct.consecutiveFailureCount = 0;
  storeProduct.lastError = null;
  storeProduct.lastCheckStatus = 'SUCCESS';
  storeProduct.lastCheckError = null;

  if (title) storeProduct.title = title;
  if (productUrl) storeProduct.productUrl = productUrl;
  if (seller) storeProduct.seller = seller;
  if (images?.length) storeProduct.images = images;
  if (rating != null) storeProduct.rating = rating;
  if (reviewCount != null) storeProduct.reviewCount = reviewCount;

  if (priceChanged) {
    storeProduct.previousPrice = previousPrice;
    storeProduct.currentPrice = newPrice;
  }
  if (isValidPrice(mrp)) storeProduct.mrp = mrp;
  if (storeProduct.mrp) {
    storeProduct.discount = storeProduct.mrp > newPrice ? Math.round(((storeProduct.mrp - newPrice) / storeProduct.mrp) * 100) : 0;
  }
  if (availabilityChanged) storeProduct.availability = newAvailability;

  await storeProduct.save();

  const { analysis, historyRecord } = await recordPriceChange({
    storeProduct,
    previousPrice,
    newPrice,
    priceChanged,
    availabilityChanged,
    newAvailability,
  });

  if (!priceChanged && !availabilityChanged) {
    // Metadata-only refresh still moves "last checked" on the product summary
    await refreshProductSummaries([storeProduct.productId]);
  }

  return { storeProduct, analysis, historyRecord, priceChanged, availabilityChanged };
};

module.exports = {
  analyzePriceChange,
  getHistoricalLowest,
  recordPriceChange,
  applyFetchedPrice,
  syncDeal,
};
