// postinstall: on Render, download Chromium INTO node_modules (PLAYWRIGHT_BROWSERS_PATH=0).
// Render's default browser cache (/opt/render/.cache) is not kept from the build into the
// running service, which left every Playwright price check failing with
// "Executable doesn't exist". node_modules is kept, so the browser travels with the build.
// Elsewhere this is a no-op unless INSTALL_PLAYWRIGHT_BROWSERS=1 (local dev keeps its own cache).
const { execSync } = require('child_process');

const onRender = Boolean(process.env.RENDER);
if (!onRender && process.env.INSTALL_PLAYWRIGHT_BROWSERS !== '1') process.exit(0);

try {
  execSync('npx playwright install chromium', {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '0' },
  });
} catch (err) {
  // Don't fail the whole deploy: the API still works, only Playwright checks would fail
  console.error('[installBrowsers] Chromium download failed:', err.message);
}
