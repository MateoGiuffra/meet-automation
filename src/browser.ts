import { chromium, BrowserContext, Page } from 'playwright';
import { config } from './config.js';
import { getLogger } from './logger.js';

const logger = getLogger('browser');

// ── Flags validas para Windows (Chromium) ───────────────────────────
// Fuente: chrome-launcher defaults + chromium/common/chrome_switches.cc
// IMPORTANTE: --no-sandbox y --disable-setuid-sandbox son SOLO Linux.
const FIRST_RUN_SUPPRESSION_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-default-apps',
];

const ANTI_DETECTION_ARGS = [
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-client-side-phishing-detection',
  '--disable-sync',
  '--metrics-recording-only',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-hang-monitor',
  '--force-color-profile=srgb',
  '--disable-search-engine-choice-screen',
];

export interface BrowserResult {
  context: BrowserContext;
  page: Page;
}

export async function launchBrowser(): Promise<BrowserResult> {
  const size = { width: config.browserWidth, height: config.browserHeight };
  const windowSize = { width: size.width, height: size.height + 80 };

  const args = [
    ...FIRST_RUN_SUPPRESSION_ARGS,
    ...ANTI_DETECTION_ARGS,
    `--window-size=${windowSize.width},${windowSize.height}`,
  ];

  const ignoreDefaultArgs = ['--mute-audio', '--enable-automation'];

  logger.info('Launching browser with persistent Chrome profile', {
    userDataDir: config.chromeUserDataDir,
    executablePath: config.chromePath,
  });

  const context = await chromium.launchPersistentContext(config.chromeUserDataDir, {
    headless: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args,
    ignoreDefaultArgs,
    executablePath: config.chromePath,
    viewport: size,
    ignoreHTTPSErrors: true,
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.setViewportSize(size);

  logger.info('Browser launched successfully');
  return { context, page };
}
