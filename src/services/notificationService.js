const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const {
  Notification,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUS,
  User,
} = require('../models');

let mailTransporter = null;

const getMailer = () => {
  if (mailTransporter) return mailTransporter;
  if (!config.email.user || !config.email.pass) {
    return null;
  }
  mailTransporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });
  return mailTransporter;
};

/**
 * Email channel abstraction — swap provider later without changing callers.
 */
const sendEmail = async ({ to, subject, text, html }) => {
  const transporter = getMailer();
  if (!transporter) {
    logger.info('Email (dev/console)', { to, subject, text });
    return { sent: true, provider: 'console' };
  }

  await transporter.sendMail({
    from: config.email.from,
    to,
    subject,
    text,
    html: html || text,
  });
  return { sent: true, provider: 'smtp' };
};

/**
 * Push channel abstraction (FCM). Without credentials, logs to console.
 * Structure allows swapping to a real FCM/HTTP v1 client later.
 */
const sendPush = async ({ tokens, title, body, data = {} }) => {
  if (!tokens?.length) {
    return { sent: false, reason: 'no_tokens' };
  }

  if (!config.fcm.serverKey) {
    logger.info('Push (dev/console)', { tokens: tokens.length, title, body, data });
    return { sent: true, provider: 'console' };
  }

  // Minimal FCM legacy HTTP API placeholder — replace with official SDK when ready
  try {
    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${config.fcm.serverKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: { title, body },
        data,
      }),
    });
    if (!response.ok) {
      throw new Error(`FCM HTTP ${response.status}`);
    }
    return { sent: true, provider: 'fcm' };
  } catch (err) {
    logger.error('Push notification failed', { error: err.message });
    return { sent: false, error: err.message };
  }
};

const createAndSend = async ({
  userId,
  type,
  title,
  message,
  channel,
  meta = {},
}) => {
  const notification = await Notification.create({
    userId,
    type,
    title,
    message,
    channel,
    status: NOTIFICATION_STATUS.PENDING,
    meta,
  });

  try {
    const user = await User.findById(userId);
    if (!user) {
      notification.status = NOTIFICATION_STATUS.FAILED;
      await notification.save();
      return notification;
    }

    if (channel === NOTIFICATION_CHANNELS.EMAIL) {
      await sendEmail({
        to: user.email,
        subject: title,
        text: message,
      });
    } else if (channel === NOTIFICATION_CHANNELS.PUSH) {
      const pushResult = await sendPush({
        tokens: user.fcmTokens || [],
        title,
        body: message,
        data: meta,
      });
      if (!pushResult?.sent) {
        notification.status = NOTIFICATION_STATUS.FAILED;
        await notification.save();
        return notification;
      }
    }
    // IN_APP: persisted record is the delivery

    notification.status = NOTIFICATION_STATUS.SENT;
    notification.sentAt = new Date();
    await notification.save();

    logger.info('Notification sent', {
      notificationId: notification._id,
      channel,
      userId,
      type,
    });
  } catch (err) {
    notification.status = NOTIFICATION_STATUS.FAILED;
    await notification.save();
    logger.error('Notification failed', {
      notificationId: notification._id,
      error: err.message,
    });
  }

  return notification;
};

const sendPriceAlertNotification = async ({
  userId,
  productId,
  storeProductId,
  title,
  currentPrice,
  targetPrice,
  alertId,
  previousPrice,
  storeName,
  productUrl,
}) => {
  const diff =
    previousPrice != null ? Math.abs(previousPrice - currentPrice) : null;
  const message = [
    `"${title}" price alert triggered.`,
    storeName ? `Store: ${storeName}.` : null,
    previousPrice != null
      ? `Price dropped from ₹${previousPrice} to ₹${currentPrice}${diff != null ? ` (₹${diff} off)` : ''}.`
      : `Current price: ₹${currentPrice}.`,
    `Your target: ₹${targetPrice}.`,
    productUrl ? `Link: ${productUrl}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const meta = {
    productId,
    storeProductId,
    alertId,
    currentPrice,
    targetPrice,
    previousPrice,
    storeName,
    productUrl,
  };

  const results = await Promise.all([
    createAndSend({
      userId,
      type: NOTIFICATION_TYPES.PRICE_ALERT,
      title: 'PRICE DROP ALERT',
      message,
      channel: NOTIFICATION_CHANNELS.EMAIL,
      meta,
    }),
    createAndSend({
      userId,
      type: NOTIFICATION_TYPES.PRICE_ALERT,
      title: 'PRICE DROP ALERT',
      message,
      channel: NOTIFICATION_CHANNELS.PUSH,
      meta,
    }),
    createAndSend({
      userId,
      type: NOTIFICATION_TYPES.PRICE_ALERT,
      title: 'PRICE DROP ALERT',
      message,
      channel: NOTIFICATION_CHANNELS.IN_APP,
      meta,
    }),
  ]);

  // Prefer EMAIL/IN_APP for anySent — PUSH may fail without FCM tokens in V1
  const anySent = results.some(
    (n) =>
      n?.status === NOTIFICATION_STATUS.SENT &&
      (n.channel === NOTIFICATION_CHANNELS.EMAIL ||
        n.channel === NOTIFICATION_CHANNELS.IN_APP ||
        n.channel === NOTIFICATION_CHANNELS.PUSH)
  );
  return { anySent, results };
};

const listNotifications = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments({ userId }),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
};

const markAsRead = async (userId, notificationId) => {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    const AppError = require('../utils/AppError');
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  notification.status = NOTIFICATION_STATUS.READ;
  notification.readAt = new Date();
  await notification.save();
  return notification;
};

module.exports = {
  sendEmail,
  sendPush,
  createAndSend,
  sendPriceAlertNotification,
  listNotifications,
  markAsRead,
};
