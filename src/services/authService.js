const jwt = require('jsonwebtoken');
const config = require('../config');
const AppError = require('../utils/AppError');
const { User, ROLES } = require('../models');

const signToken = (userId) =>
  jwt.sign({ id: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

/**
 * Older builds stored gmail addresses with dots removed (express-validator default).
 * Fall back to that form so those accounts can still sign in.
 */
const findByEmailForLogin = async (email) => {
  const normalized = email.toLowerCase();
  let user = await User.findOne({ email: normalized }).select('+password');
  if (!user) {
    const [local, domain] = normalized.split('@');
    if (['gmail.com', 'googlemail.com'].includes(domain) && local.includes('.')) {
      user = await User.findOne({ email: `${local.replace(/\./g, '')}@${domain}` }).select('+password');
    }
  }
  return user;
};

const register = async ({ name, email, password }) => {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
  }

  const user = await User.create({
    name,
    email,
    password,
    role: ROLES.USER,
  });

  const token = signToken(user._id);
  return { user: user.toSafeObject(), token };
};

const login = async ({ email, password }) => {
  const user = await findByEmailForLogin(email);
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.isActive) {
    throw new AppError('Account is deactivated', 403, 'ACCOUNT_INACTIVE');
  }

  const token = signToken(user._id);
  return { user: user.toSafeObject(), token };
};

const getMe = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return user.toSafeObject();
};

const updateProfile = async (userId, { name }) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (name !== undefined) user.name = name;
  await user.save();
  return user.toSafeObject();
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (!(await user.comparePassword(currentPassword))) {
    throw new AppError('Current password is incorrect', 400, 'INVALID_PASSWORD');
  }
  if (currentPassword === newPassword) {
    throw new AppError('New password must differ from the current one', 400, 'SAME_PASSWORD');
  }
  user.password = newPassword;
  await user.save();
  // Old tokens are invalidated via passwordChangedAt; hand back a fresh one
  return { user: user.toSafeObject(), token: signToken(user._id) };
};

module.exports = { register, login, getMe, updateProfile, changePassword, signToken };
