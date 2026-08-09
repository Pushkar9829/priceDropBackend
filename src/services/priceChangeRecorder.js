const logger = require('../utils/logger');
const { calcPercentageChange, calcPriceDifference } = require('../utils/helpers');
const config = require('../config');
const { PriceHistory, Deal } = require('../models');
const { isValidPrice } = require('../integrations/stores/base/validator');
const alertService = require('./alertService');

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
  const isHistoricalLow =
    changeType === 'DECREASE' &&
    (historicalLowest == null || newPrice <= historicalLowest);

  if (changeType === 'DECREASE') {
    const absPct = Math.abs(percentageChange || 0);
    if (isHistoricalLow) dropSeverity = 'HISTORICAL_LOW';
    else if (absPct >= config.priceDrop.majorPercent) dropSeverity = 'MAJOR';
    else if (absPct >= config.priceDrop.significantPercent) dropSeverity = 'SIGNIFICANT';
    else dropSeverity = 'NORMAL';
  }

  return {
    changeType,
    priceDifference,
    percentageChange,
    dropSeverity,
    isHistoricalLow,
  };
};

const getHistoricalLowest = async (storeProductId) => {
  const result = await PriceHistory.findOne({ storeProductId })
    .sort({ newPrice: 1 })
    .select('newPrice')
    .lean();
  return result?.newPrice ?? null;
};

/**
 * Record a price / availability change: history + deals + alerts.
 * Caller must already update and save StoreProduct fields (or pass unsaved doc after mutating).
 *
 * @param {object} params
 * @param {import('mongoose').Document} params.storeProduct - saved listing
 * @param {number|null} params.previousPrice
 * @param {number} params.newPrice
 * @param {boolean} params.priceChanged
 * @param {boolean} [params.availabilityChanged=false]
 * @param {string} [params.previousAvailability]
 * @param {string} params.newAvailability
 * @returns {Promise<{ analysis: object, historyRecord: object|null }>}
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

  const historicalLowest = await getHistoricalLowest(storeProduct._id);
  const analysis = analyzePriceChange(
    priceChanged ? previousPrice : newPrice,
    newPrice,
    historicalLowest
  );

  if (availabilityChanged && !priceChanged) {
    analysis.changeType = 'AVAILABILITY_CHANGE';
  }

  const historyRecord = await PriceHistory.create({
    productId: storeProduct.productId,
    storeProductId: storeProduct._id,
    storeId: storeProduct.storeId,
    previousPrice: priceChanged ? previousPrice : newPrice,
    newPrice,
    priceDifference: priceChanged ? analysis.priceDifference : 0,
    percentageChange: priceChanged ? analysis.percentageChange : 0,
    availability: newAvailability || storeProduct.availability || 'UNKNOWN',
    changeType: priceChanged ? analysis.changeType : 'AVAILABILITY_CHANGE',
    isHistoricalLow: priceChanged ? analysis.isHistoricalLow : false,
    dropSeverity: priceChanged ? analysis.dropSeverity : 'NONE',
    recordedAt: new Date(),
  });

  if (priceChanged) {
    if (analysis.changeType === 'DECREASE') {
      logger.info('Price decreased', {
        storeProductId: storeProduct._id,
        previousPrice,
        newPrice,
        priceDifference: analysis.priceDifference,
        percentageChange: analysis.percentageChange,
        dropSeverity: analysis.dropSeverity,
      });
    } else if (analysis.changeType === 'INCREASE') {
      logger.info('Price increased', {
        storeProductId: storeProduct._id,
        previousPrice,
        newPrice,
        priceDifference: analysis.priceDifference,
        percentageChange: analysis.percentageChange,
      });
    }

    if (analysis.isHistoricalLow) {
      logger.info('New historical low detected', {
        storeProductId: storeProduct._id,
        newPrice,
        previousHistoricalLow: historicalLowest,
      });
    }

    if (['SIGNIFICANT', 'MAJOR', 'HISTORICAL_LOW'].includes(analysis.dropSeverity)) {
      await Deal.findOneAndUpdate(
        { storeProductId: storeProduct._id, isActive: true },
        {
          productId: storeProduct.productId,
          storeProductId: storeProduct._id,
          storeId: storeProduct.storeId,
          title: `Price drop: ${storeProduct.title}`,
          description: `Price dropped from ₹${previousPrice} to ₹${newPrice} (${Math.abs(analysis.percentageChange)}%)`,
          previousPrice,
          currentPrice: newPrice,
          discountPercent: Math.abs(analysis.percentageChange),
          dropSeverity:
            analysis.dropSeverity === 'HISTORICAL_LOW'
              ? 'HISTORICAL_LOW'
              : analysis.dropSeverity,
          isHistoricalLow: analysis.isHistoricalLow,
          isActive: true,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        { upsert: true, new: true }
      );
    }

    await alertService.checkAlertsForPriceChange({
      productId: storeProduct.productId,
      storeProductId: storeProduct._id,
      currentPrice: newPrice,
      previousPrice,
      title: storeProduct.title,
    });
  }

  logger.info(priceChanged ? 'Price changed' : 'Availability changed', {
    storeProductId: storeProduct._id,
    changeType: analysis.changeType,
    previousPrice: priceChanged ? previousPrice : undefined,
    newPrice,
    availability: newAvailability,
  });

  return { analysis, historyRecord };
};

/**
 * Apply a newly fetched price onto a StoreProduct and record side effects.
 * Used by search upsert when price changes on an existing listing.
 */
const applyFetchedPrice = async (storeProduct, {
  newPrice,
  mrp,
  availability,
  title,
  productUrl,
  images,
  rating,
  reviewCount,
  seller,
}) => {
  const previousPrice = storeProduct.currentPrice;
  const previousAvailability = storeProduct.availability;
  const newAvailability = availability || previousAvailability || 'UNKNOWN';
  const priceChanged = previousPrice !== newPrice;
  const availabilityChanged = previousAvailability !== newAvailability;

  const now = new Date();
  storeProduct.lastCheckedAt = now;
  storeProduct.lastSuccessfulFetchAt = now;
  storeProduct.scrapeStatus = 'SUCCESS';
  storeProduct.consecutiveFailureCount = 0;
  storeProduct.lastError = null;
  storeProduct.lastCheckStatus = 'SUCCESS';
  storeProduct.lastCheckError = null;

  if (title) storeProduct.title = title;
  if (productUrl) storeProduct.productUrl = productUrl;
  if (seller != null) storeProduct.seller = seller;
  if (images) storeProduct.images = images;
  if (rating != null) storeProduct.rating = rating;
  if (reviewCount != null) storeProduct.reviewCount = reviewCount;

  if (priceChanged) {
    storeProduct.previousPrice = previousPrice;
    storeProduct.currentPrice = newPrice;
  }
  if (isValidPrice(mrp)) {
    storeProduct.mrp = mrp;
    storeProduct.discount = Math.round(((mrp - newPrice) / mrp) * 100);
  }
  if (availabilityChanged) {
    storeProduct.availability = newAvailability;
  }

  await storeProduct.save();

  const { analysis, historyRecord } = await recordPriceChange({
    storeProduct,
    previousPrice,
    newPrice,
    priceChanged,
    availabilityChanged,
    newAvailability,
  });

  return { storeProduct, analysis, historyRecord, priceChanged, availabilityChanged };
};

module.exports = {
  analyzePriceChange,
  getHistoricalLowest,
  recordPriceChange,
  applyFetchedPrice,
};
