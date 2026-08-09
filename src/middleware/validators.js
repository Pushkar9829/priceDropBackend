const { body, param, query } = require('express-validator');

const registerRules = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

const loginRules = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

const searchRules = [
  query('q').optional().trim().isLength({ min: 1 }).withMessage('Query cannot be empty'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
];

const priceAlertRules = [
  body('productId').isMongoId().withMessage('Valid productId is required'),
  body('targetPrice').isFloat({ min: 0 }).withMessage('Valid targetPrice is required'),
  body('storeProductId').optional({ nullable: true }).isMongoId(),
];

const storeRules = [
  body('name').trim().notEmpty().withMessage('Store name is required'),
  body('slug').optional().trim(),
  body('domain').trim().notEmpty().withMessage('Domain is required'),
];

const mongoIdParam = (name = 'id') => [param(name).isMongoId().withMessage(`Valid ${name} is required`)];

module.exports = {
  registerRules,
  loginRules,
  searchRules,
  priceAlertRules,
  storeRules,
  mongoIdParam,
};
