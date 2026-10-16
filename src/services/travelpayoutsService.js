const axios = require('axios');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const settingsService = require('./settingsService');
const { createTtlCache } = require('../utils/ttlCache');

/**
 * Travelpayouts Data API — cheapest one-way fares from a city, for the travel page.
 * Fares are Aviasales' cached search results (minutes to a couple of days old), so they are
 * shown as "from ₹X"; the booking link opens the live search with our marker attached.
 */
const API = 'https://api.travelpayouts.com';
const BOOK_BASE = 'https://www.aviasales.com';

const fareCache = createTtlCache({ ttlMs: 60 * 60 * 1000, max: 50 }); // 1 h per city
let cityNames = null; // code → { name, country }
let cityNamesAt = 0;

/** IATA city code → name, from Travelpayouts' public list (refreshed daily). */
const loadCityNames = async () => {
  if (cityNames && Date.now() - cityNamesAt < 24 * 60 * 60 * 1000) return cityNames;
  try {
    const { data } = await axios.get(`${API}/data/en/cities.json`, { timeout: 30_000 });
    cityNames = new Map((data || []).map((c) => [c.code, { name: c.name, country: c.country_code }]));
    cityNamesAt = Date.now();
  } catch (err) {
    logger.warn('Travelpayouts city list unavailable', { error: err.message });
    cityNames = cityNames || new Map();
  }
  return cityNames;
};

const bookingUrl = (link, marker) => {
  if (!link) return '';
  const url = `${BOOK_BASE}${link.startsWith('/') ? '' : '/'}${link}`;
  return marker ? `${url}${url.includes('?') ? '&' : '?'}marker=${encodeURIComponent(marker)}` : url;
};

/** Cheapest destinations from `origin` (3-letter code) — about 12 fares, one per destination. */
const cheapFlights = async (origin) => {
  const code = String(origin || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new AppError('Origin must be a 3-letter city code', 400, 'INVALID_CITY');
  const s = await settingsService.getAffiliateSettings();
  const token = settingsService.travelpayoutsToken(s);
  if (!token) return { origin: code, originName: code, fares: [], enabled: false };

  return fareCache.get(`${code}:${s.travelpayouts.marker}`, async () => {
    const [names, res] = await Promise.all([
      loadCityNames(),
      axios
        .get(`${API}/aviasales/v3/prices_for_dates`, {
          timeout: 20_000,
          headers: { 'X-Access-Token': token },
          params: { origin: code, currency: 'inr', sorting: 'price', one_way: true, unique: true, limit: 30, market: 'in' },
        })
        .catch((err) => {
          const status = err.response?.status;
          logger.warn('Travelpayouts fares failed', { origin: code, status, error: err.message });
          throw new AppError(status === 401 ? 'Travelpayouts token was rejected' : 'Flight prices are unavailable right now', 502, 'FARES_UNAVAILABLE');
        }),
    ]);
    const name = (c) => names.get(c)?.name || c;
    const fares = (res.data?.data || [])
      .filter((f) => f.price > 0 && f.destination && f.destination !== code)
      .slice(0, 12)
      .map((f) => ({
        to: f.destination,
        toName: name(f.destination),
        price: f.price,
        departureAt: f.departure_at,
        airline: f.airline,
        transfers: f.transfers ?? 0,
        durationMin: f.duration_to || f.duration || null,
        url: bookingUrl(f.link, s.travelpayouts.marker),
      }));
    return { origin: code, originName: name(code), fares, enabled: true };
  });
};

const clearCache = () => fareCache.clear();

module.exports = { cheapFlights, clearCache };
