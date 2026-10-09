const { User, ROLES } = require('./User');
const { Store, INTEGRATION_TYPES } = require('./Store');
const Product = require('./Product');
const { StoreProduct, AVAILABILITY, SCRAPE_STATUS } = require('./StoreProduct');
const PriceHistory = require('./PriceHistory');
const Watchlist = require('./Watchlist');
const { PriceAlert, ALERT_STATUS } = require('./PriceAlert');
const {
  Notification,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUS,
} = require('./Notification');
const Deal = require('./Deal');
const Brand = require('./Brand');
const Lock = require('./Lock');

module.exports = {
  User,
  ROLES,
  Store,
  INTEGRATION_TYPES,
  Product,
  StoreProduct,
  AVAILABILITY,
  SCRAPE_STATUS,
  PriceHistory,
  Watchlist,
  PriceAlert,
  ALERT_STATUS,
  Notification,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUS,
  Deal,
  Brand,
  Lock,
};
