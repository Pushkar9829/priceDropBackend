const jwt = require('jsonwebtoken');
const config = require('../config');
const AppError = require('../utils/AppError');
const { User, ROLES } = require('../models');

const signToken = (userId) =>
  jwt.sign({ id: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

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
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
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

module.exports = { register, login, getMe, signToken };
