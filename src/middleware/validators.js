const { body, param, query } = require('express-validator');

// Keep dots in gmail addresses so stored emails match what users typed
const emailNormalize = { gmail_remove_dots: false, gmail_remove_subaddress: false };

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(emailNormalize),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be 8–128 characters'),
];

const loginRules = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(emailNormalize),
  body('password').notEmpty().withMessage('Password is required'),
];

const updateProfileRules = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 100 }),
];

const changePasswordRules = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('New password must be 8–128 characters'),
];

const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'newest'];

const searchRules = [
  query('q').optional().isString().withMessage('q must be text').trim().isLength({ max: 200 }),
  query('page').optional().isInt({ min: 1, max: 500 }).withMessage('page must be 1–500'),
  query('limit').optional().isInt({ min: 1, max: 48 }),
  query('sort').optional().isIn(SEARCH_SORTS).withMessage(`sort must be one of ${SEARCH_SORTS.join(', ')}`),
  query('category').optional().isString().withMessage('category must be text').trim().isLength({ max: 100 }),
  query('brand').optional().isString().withMessage('brand must be text').trim().isLength({ max: 100 }),
  query('minPrice').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('minPrice must be a positive number'),
  query('maxPrice').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('maxPrice must be a positive number'),
];

const priceHistoryQueryRules = [
  query('days').optional().isInt({ min: 1, max: 730 }).withMessage('days must be 1–730'),
  query('storeProductId').optional().isMongoId(),
];

const priceAlertRules = [
  body('productId').isMongoId().withMessage('Valid productId is required'),
  body('targetPrice').isFloat({ gt: 0 }).withMessage('targetPrice must be greater than 0').toFloat(),
  body('storeProductId').optional({ nullable: true }).isMongoId(),
];

const priceAlertUpdateRules = [
  body('targetPrice').optional().isFloat({ gt: 0 }).withMessage('targetPrice must be greater than 0').toFloat(),
  body('status').optional().isIn(['ACTIVE', 'PAUSED', 'CANCELLED']),
];

const storeRules = [
  body('name').trim().notEmpty().withMessage('Store name is required').isLength({ max: 100 }),
  body('slug').optional().trim().isSlug(),
  body('domain').trim().notEmpty().withMessage('Domain is required'),
  body('logo').optional().trim().isLength({ max: 500 }),
];

const storeUpdateRules = [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }),
  body('domain').optional().trim().notEmpty(),
  body('logo').optional().trim().isLength({ max: 500 }),
  body('isActive').optional().isBoolean().toBoolean(),
];

const storeProductUpdateRules = [
  body('productUrl').optional().trim().isURL({ require_protocol: true }).withMessage('productUrl must be a full URL'),
  body('affiliateUrl')
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ require_protocol: true })
    .withMessage('affiliateUrl must be a full URL'),
  body('externalProductId').optional().trim().notEmpty(),
  body('title').optional().trim().notEmpty(),
  body('seller').optional().trim(),
  body('isActive').optional().isBoolean().toBoolean(),
];

const importRules = [
  body('url').trim().isURL({ require_protocol: true }).withMessage('A full product URL is required'),
  body('productId').optional({ checkFalsy: true }).isMongoId(),
];

const keywordScrapeRules = [
  body('query').trim().notEmpty().withMessage('Search keyword is required').isLength({ max: 200 }),
  body('stores').optional().isArray({ min: 1 }),
  body('stores.*').optional().isIn(['amazon', 'flipkart', 'croma']),
];

const dealRules = [
  body('productId').isMongoId().withMessage('Valid productId is required'),
  body('storeProductId').isMongoId().withMessage('Valid storeProductId is required'),
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('discountPercent').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('dropSeverity').optional().isIn(['NORMAL', 'SIGNIFICANT', 'MAJOR', 'HISTORICAL_LOW']),
  body('expiresAt').optional({ nullable: true }).isISO8601(),
];

const dealUpdateRules = [
  body('title').optional().trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('discountPercent').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('dropSeverity').optional().isIn(['NORMAL', 'SIGNIFICANT', 'MAJOR', 'HISTORICAL_LOW']),
  body('isActive').optional().isBoolean().toBoolean(),
  body('expiresAt').optional({ nullable: true }).isISO8601(),
];

const userUpdateRules = [
  body('isActive').optional().isBoolean().toBoolean(),
  body('role').optional().isIn(['USER', 'ADMIN']),
];

const mongoIdParam = (name = 'id') => [param(name).isMongoId().withMessage(`Valid ${name} is required`)];

module.exports = {
  registerRules,
  loginRules,
  updateProfileRules,
  changePasswordRules,
  searchRules,
  SEARCH_SORTS,
  priceHistoryQueryRules,
  priceAlertRules,
  priceAlertUpdateRules,
  storeRules,
  storeUpdateRules,
  storeProductUpdateRules,
  importRules,
  keywordScrapeRules,
  dealRules,
  dealUpdateRules,
  userUpdateRules,
  mongoIdParam,
};
