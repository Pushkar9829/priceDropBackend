const config = require('../../../config');
const logger = require('../../../utils/logger');
const { CollectionError, FETCH_ERRORS } = require('./store.types');

/**
 * Playwright browser client — used ONLY when SCRAPER_ENABLE_PLAYWRIGHT=true
 * and HTTP/Cheerio cannot obtain the data from a permitted source.
 *
 * Lazy-loads playwright so the app starts without browsers installed.
 */
let browserPromise = null;
// Sessions in flight. closeBrowser() defers while > 0 so one caller (e.g. an admin import)
// can't kill the shared browser under a running monitor batch.
let activeSessions = 0;
let closeRequested = false;

const DEFAULT_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getBrowser = async () => {
  if (!config.scraper.enablePlaywright) {
    throw new CollectionError(
      'Playwright is disabled. Set SCRAPER_ENABLE_PLAYWRIGHT=true to enable.',
      FETCH_ERRORS.UNSUPPORTED
    );
  }

  if (!browserPromise) {
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      const { chromium } = require('playwright');
      const launchArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-default-browser-check',
      ];
      // Prefer installed Chrome — bundled Chromium is often blocked by Amazon/Croma
      browserPromise = chromium
        .launch({
          channel: 'chrome',
          headless: true,
          args: launchArgs,
        })
        .catch(() =>
          chromium.launch({
            headless: true,
            args: launchArgs,
          })
        );
    } catch (err) {
      throw new CollectionError(
        `Playwright not available: ${err.message}. Run: npx playwright install chromium`,
        FETCH_ERRORS.UNSUPPORTED
      );
    }
  }

  return browserPromise;
};

const buildContextOptions = ({ locale, userAgent }) => ({
  userAgent,
  locale,
  timezoneId: 'Asia/Kolkata',
  viewport: { width: 1366, height: 768 },
  acceptDownloads: false,
  ignoreHTTPSErrors: true,
  extraHTTPHeaders: {
    'Accept-Language': 'en-IN,en;q=0.9',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  },
});

const attachPageGuards = async (page) => {
  page.on('download', async (download) => {
    try {
      await download.cancel();
    } catch {
      // ignore
    }
  });

  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'deny',
      eventsEnabled: false,
    }).catch(async () => {
      await client.send('Page.setDownloadBehavior', {
        behavior: 'deny',
        downloadPath: '',
      }).catch(() => {});
    });
  } catch {
    // CDP optional
  }
};

const isNavInterrupt = (err) =>
  /Download is starting|interrupted by another navigation|Execution context was destroyed|net::ERR_ABORTED/i.test(
    err?.message || ''
  );

/**
 * Navigate resiliently — Amazon.in often trips Playwright's "Download is starting".
 */
const gotoResilient = async (page, targetUrl, timeoutMs) => {
  const tryGoto = async (waitUntil) => {
    await page.goto(targetUrl, { waitUntil, timeout: timeoutMs });
  };

  try {
    await tryGoto('commit');
    await sleep(800);
    await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeoutMs, 20_000) }).catch(() => {});
    if (!page.url().startsWith('chrome-error://')) return;
  } catch (navErr) {
    if (!isNavInterrupt(navErr)) throw navErr;
    logger.warn('Playwright navigation interrupted; retrying', {
      url: targetUrl,
      error: navErr.message.split('\n')[0],
    });
  }

  try {
    await tryGoto('domcontentloaded');
    if (!page.url().startsWith('chrome-error://')) return;
  } catch (retryErr) {
    if (!isNavInterrupt(retryErr)) throw retryErr;
    logger.warn('Playwright retry interrupted; using location assign', { url: targetUrl });
  }

  // Client-side nav — pair evaluate with waitForNavigation so context destroy is expected
  try {
    await page.goto('about:blank', { waitUntil: 'commit', timeout: 10_000 });
  } catch {
    // ignore
  }

  try {
    await Promise.all([
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      }),
      page.evaluate((u) => {
        window.location.href = u;
      }, targetUrl),
    ]);
  } catch (assignErr) {
    // evaluate often throws "context destroyed" even when navigation succeeds
    if (!isNavInterrupt(assignErr)) throw assignErr;
    await page
      .waitForLoadState('domcontentloaded', { timeout: timeoutMs })
      .catch(() => {});
  }

  await sleep(1500);

  if (page.url().startsWith('chrome-error://')) {
    throw new CollectionError(
      `Browser failed to load ${targetUrl} (chrome-error page)`,
      FETCH_ERRORS.NETWORK
    );
  }
};

const dismissAmazonInterstitial = async (page) => {
  try {
    const continueBtn = page.locator(
      'button:has-text("Continue shopping"), a:has-text("Continue shopping"), input[aria-labelledby="continue-button-announce"]'
    );
    if (await continueBtn.first().isVisible({ timeout: 1500 })) {
      await continueBtn.first().click({ timeout: 3000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      await sleep(800);
    }
  } catch {
    // ignore
  }
};

const assertNotBlocked = async (page, html) => {
  const title = await page.title().catch(() => '');
  if (/access denied|robot check|captcha/i.test(title) || /access denied/i.test(html.slice(0, 2000))) {
    throw new CollectionError(
      `Store blocked the request (${title || 'Access Denied'})`,
      FETCH_ERRORS.NETWORK
    );
  }
};

/**
 * Multi-page session (reuse cookies/context across Amazon search pages).
 * @returns {Promise<{ page: import('playwright').Page, goto: Function, content: Function, close: Function }>}
 */
const openBrowserSession = async (options = {}) => {
  const {
    timeoutMs = config.scraper.timeoutMs,
    locale = 'en-IN',
    userAgent = config.scraper.userAgent?.includes('PriceCompareBot')
      ? DEFAULT_BROWSER_UA
      : config.scraper.userAgent || DEFAULT_BROWSER_UA,
  } = options;

  const browser = await getBrowser();
  activeSessions += 1;
  let context;
  try {
    context = await browser.newContext(buildContextOptions({ locale, userAgent }));
  } catch (err) {
    activeSessions -= 1;
    throw err;
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  await attachPageGuards(page);
  let closed = false;

  return {
    page,
    async goto(url, { waitSelector, delayMs = 0 } = {}) {
      logger.debug('Playwright fetch started', { url });
      await gotoResilient(page, url, timeoutMs);
      await dismissAmazonInterstitial(page);

      if (waitSelector) {
        try {
          await page.waitForSelector(waitSelector, {
            timeout: Math.min(timeoutMs, 20_000),
          });
        } catch {
          logger.debug('Playwright waitSelector timed out', { url, waitSelector });
        }
      }
      if (delayMs > 0) await sleep(delayMs);
    },
    async content() {
      const html = await page.content();
      await assertNotBlocked(page, html);
      return { html, url: page.url() };
    },
    async close() {
      if (closed) return;
      closed = true;
      await context.close().catch(() => {});
      activeSessions = Math.max(0, activeSessions - 1);
      if (closeRequested && activeSessions === 0) await closeBrowser();
    },
  };
};

/**
 * @param {string} url
 * @param {{ waitSelector?: string, timeoutMs?: number, delayMs?: number, locale?: string, userAgent?: string }} [options]
 */
const fetchRenderedHtml = async (url, options = {}) => {
  const {
    waitSelector,
    timeoutMs = config.scraper.timeoutMs,
    delayMs = 0,
    locale = 'en-IN',
    userAgent = config.scraper.userAgent?.includes('PriceCompareBot')
      ? DEFAULT_BROWSER_UA
      : config.scraper.userAgent || DEFAULT_BROWSER_UA,
  } = options;

  const session = await openBrowserSession({ timeoutMs, locale, userAgent });
  try {
    await session.goto(url, { waitSelector, delayMs });
    return await session.content();
  } catch (err) {
    if (err instanceof CollectionError) throw err;
    throw new CollectionError(
      `Playwright fetch failed for ${url}: ${err.message}`,
      FETCH_ERRORS.NETWORK
    );
  } finally {
    await session.close();
  }
};

/**
 * Close the shared browser to free memory. Deferred until in-flight sessions finish
 * unless { force: true } (shutdown).
 */
const closeBrowser = async ({ force = false } = {}) => {
  if (!force && activeSessions > 0) {
    closeRequested = true;
    return;
  }
  closeRequested = false;
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await browser.close();
    } catch {
      // ignore
    }
    browserPromise = null;
  }
};

module.exports = {
  fetchRenderedHtml,
  openBrowserSession,
  closeBrowser,
};
