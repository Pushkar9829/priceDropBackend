const jwt = require('jsonwebtoken');
const config = require('../config');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { User, ROLES } = require('../models');

// Runs on every authenticated request: read a plain object with only the fields we need
const loadUser = (id) => User.findById(id).select('name email role isActive passwordChangedAt').lean();
const changedPasswordAfter = (user, iat) =>
  Boolean(user.passwordChangedAt && iat && Math.floor(new Date(user.passwordChangedAt).getTime() / 1000) > iat);

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const decoded = jwt.verify(token, config.jwt.secret);
  const user = await loadUser(decoded.id);

  if (!user || !user.isActive) {
    throw new AppError('User not found or inactive', 401, 'UNAUTHORIZED');
  }

  if (changedPasswordAfter(user, decoded.iat)) {
    throw new AppError('Password changed — please log in again', 401, 'TOKEN_EXPIRED');
  }

  req.user = user;
  next();
});

const optionalAuth = asyncHandler(async (req, res, next) => {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await loadUser(decoded.id);
    if (user && user.isActive && !changedPasswordAfter(user, decoded.iat)) {
      req.user = user;
    }
  } catch {
    // ignore invalid token for optional auth
  }

  next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new AppError('Forbidden: insufficient permissions', 403, 'FORBIDDEN'));
  }
  next();
};

const adminOnly = authorize(ROLES.ADMIN);

module.exports = { protect, optionalAuth, authorize, adminOnly, ROLES };
