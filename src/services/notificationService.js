const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
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
  if (!config.email.host || !config.email.user || !config.email.pass) {
    return null;
  }
  mailTransporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    // A slow SMTP server must not stall the price monitor (alerts send inside a check)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
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
    if (config.env === 'production') {
      // Not configured: record the email as not sent (never pretend), no PII in logs
      return { sent: false, reason: 'smtp_not_configured' };
    }
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
      const emailResult = await sendEmail({
        to: user.email,
        subject: title,
        text: message,
      });
      if (!emailResult?.sent) {
        notification.status = NOTIFICATION_STATUS.FAILED;
        await notification.save();
        return notification;
      }
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

const hasPushTokens = async (userId) => {
  const user = await User.findById(userId).select('fcmTokens').lean();
  return Boolean(user?.fcmTokens?.length);
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
  const inr = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
  const dropped = previousPrice != null && previousPrice > currentPrice;
  const at = storeName ? ` at ${storeName}` : '';
  // In-app copy stays short; the email adds the store link
  const message = dropped
    ? `${title} dropped from ${inr(previousPrice)} to ${inr(currentPrice)}${at} — at or below your ${inr(targetPrice)} target.`
    : `${title} is ${inr(currentPrice)}${at} — at or below your ${inr(targetPrice)} target.`;
  const emailText = productUrl ? `${message}

Buy it here: ${productUrl}` : message;

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
      title: 'Price drop alert',
      message: emailText,
      channel: NOTIFICATION_CHANNELS.EMAIL,
      meta,
    }),
    hasPushTokens(userId).then((ok) =>
      ok
        ? createAndSend({
            userId,
            type: NOTIFICATION_TYPES.PRICE_ALERT,
            title: 'Price drop alert',
            message,
            channel: NOTIFICATION_CHANNELS.PUSH,
            meta,
          })
        : null
    ),
    createAndSend({
      userId,
      type: NOTIFICATION_TYPES.PRICE_ALERT,
      title: 'Price drop alert',
      message,
      channel: NOTIFICATION_CHANNELS.IN_APP,
      meta,
    }),
  ]);

  // Any successful channel counts — PUSH commonly fails in V1 (no FCM tokens registered)
  const anySent = results.some((n) => n?.status === NOTIFICATION_STATUS.SENT);
  return { anySent, results };
};

// Users see one copy per event: the IN_APP record. EMAIL/PUSH records are delivery logs (admin view).
const userInboxFilter = (userId) => ({ userId, channel: NOTIFICATION_CHANNELS.IN_APP });

const listNotifications = async (userId, { page = 1, limit = 20 } = {}) => {
  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));
  const filter = userInboxFilter(userId);
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    Notification.countDocuments(filter),
    countUnread(userId),
  ]);
  return { items, total, unread, page: p, limit: l, pages: Math.ceil(total / l) || 1 };
};

const countUnread = (userId) =>
  Notification.countDocuments({
    ...userInboxFilter(userId),
    status: { $ne: NOTIFICATION_STATUS.READ },
  });

const markAsRead = async (userId, notificationId) => {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  notification.status = NOTIFICATION_STATUS.READ;
  notification.readAt = new Date();
  await notification.save();
  return notification;
};

const markAllAsRead = async (userId) => {
  const result = await Notification.updateMany(
    { ...userInboxFilter(userId), status: { $ne: NOTIFICATION_STATUS.READ } },
    { $set: { status: NOTIFICATION_STATUS.READ, readAt: new Date() } }
  );
  return result.modifiedCount || 0;
};

module.exports = {
  sendEmail,
  sendPush,
  createAndSend,
  sendPriceAlertNotification,
  listNotifications,
  countUnread,
  markAsRead,
  markAllAsRead,
};
