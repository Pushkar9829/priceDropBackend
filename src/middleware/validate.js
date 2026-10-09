const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const list = errors.array();
    const first = list[0];
    const message = first?.msg && first.msg !== 'Invalid value' ? first.msg : `Invalid ${first?.path || 'input'}`;
    throw new AppError(message, 400, 'VALIDATION_ERROR', list);
  }
  next();
};

module.exports = validate;
