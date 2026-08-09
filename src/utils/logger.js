const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const shouldLog = (level) => levels[level] <= levels[currentLevel];

const formatLog = (level, message, meta = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  return JSON.stringify(entry);
};

const logger = {
  error(message, meta) {
    if (shouldLog('error')) console.error(formatLog('error', message, meta));
  },
  warn(message, meta) {
    if (shouldLog('warn')) console.warn(formatLog('warn', message, meta));
  },
  info(message, meta) {
    if (shouldLog('info')) console.log(formatLog('info', message, meta));
  },
  debug(message, meta) {
    if (shouldLog('debug')) console.log(formatLog('debug', message, meta));
  },
};

module.exports = logger;
