import { Page } from 'playwright';
import { randomBytes } from 'crypto';
import { getLogger } from '../logger.js';
import {
  CAPTION_REGION_SELECTOR,
  CAPTION_REGION_SELECTOR_DE,
  CAPTION_TOGGLE_LABELS,
} from './constants.js';
import type { CaptionCallback } from './types.js';

const logger = getLogger('scraping/captions');

const BRIDGE_SECRET = randomBytes(16).toString('hex');

// ── Exposed function name on the window object ──────────────────────────
const BROWSER_BRIDGE_NAME = '__meetCaptionBridge';

// ── Internal state ──────────────────────────────────────────────────────
let observerActive = false;

/**
 * Find and click the caption toggle button (CC icon).
 * Returns true if captions were enabled, false if already on or not found.
 */
export async function enableCaptions(page: Page): Promise<boolean> {
  for (const label of CAPTION_TOGGLE_LABELS) {
    try {
      const btn = page
        .locator(`button[aria-label="${label}"]`)
        .first();

      const isVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!isVisible) continue;

      const ariaPressed = await btn.getAttribute('aria-pressed');
      if (ariaPressed === 'true') {
        logger.info('Captions already enabled', { label });
        return false;
      }

      await btn.click();
      logger.info('Caption toggle clicked', { label });
      await page.waitForTimeout(500);

      // Verify the caption region appeared
      const regionSelector = `${CAPTION_REGION_SELECTOR}, ${CAPTION_REGION_SELECTOR_DE}`;
      const regionVisible = await page
        .locator(regionSelector)
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (regionVisible) {
        logger.info('Caption region detected after toggle');
        return true;
      }

      logger.warn('Caption region not visible after toggle click');
    } catch {
      // try next label
    }
  }

  // Check if captions are already on (region already present)
  const regionSelector = `${CAPTION_REGION_SELECTOR}, ${CAPTION_REGION_SELECTOR_DE}`;
  const alreadyActive = await page
    .locator(regionSelector)
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);

  if (alreadyActive) {
    logger.info('Caption region already present — captions were on');
    return false;
  }

  logger.warn('Could not enable captions — toggle not found or region missing');
  return false;
}

/**
 * Check if the caption region is visible in the DOM.
 */
export async function isCaptionsActive(page: Page): Promise<boolean> {
  const regionSelector = `${CAPTION_REGION_SELECTOR}, ${CAPTION_REGION_SELECTOR_DE}`;
  return page
    .locator(regionSelector)
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
}

/**
 * Set up the MutationObserver inside the browser that watches for new
 * caption text and calls back into Node via the exposed bridge.
 *
 * Must be called AFTER enableCaptions() so the caption region exists.
 */
export async function setupCaptionScraper(page: Page, callback: CaptionCallback): Promise<void> {
  if (observerActive) {
    logger.warn('Caption scraper already active — skipping setup');
    return;
  }

  // 1. Expose the bridge function: browser → Node
  await page.exposeFunction(BROWSER_BRIDGE_NAME, async (speaker: string, text: string) => {
    const event = { speaker, text, timestamp: Date.now() };
    try {
      await callback(event);
    } catch (err) {
      logger.error('Caption callback error', { error: err });
    }
  });

  // 2. Inject the MutationObserver script into the browser
  await page.evaluate(
    ({ regionSelector, bridgeName, secret }) => {
      // Guard: avoid duplicate injection
      if ((window as any).__meetCaptionObserverActive) return;
      (window as any).__meetCaptionObserverActive = true;

      const region = document.querySelector(regionSelector);
      if (!region) {
        console.warn('[meet-automation] Caption region not found for observer');
        return;
      }

      let lastKnownSpeaker = 'Unknown Speaker';
      const seenCaptions = new Set<string>();

      const handleNode = (node: Node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!node.isConnected) return;

        // Skip if this is the region itself
        if (node.getAttribute?.('role') === 'region') return;

        const speakerEl = node.querySelector('.NWpY1d');
        const speaker = speakerEl?.textContent?.trim() || lastKnownSpeaker;
        if (speaker !== 'Unknown Speaker') {
          lastKnownSpeaker = speaker;
        }

        // Clone to strip the speaker label, leaving only the caption text
        const clone = node.cloneNode(true) as HTMLElement;
        const speakerLabel = clone.querySelector('.NWpY1d');
        if (speakerLabel) speakerLabel.remove();

        const caption = clone.textContent?.trim() || '';

        if (
          caption &&
          caption.toLowerCase() !== speaker.toLowerCase() &&
          !seenCaptions.has(caption)
        ) {
          seenCaptions.add(caption);
          (window as any)[bridgeName](speaker, caption);
        }
      };

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => handleNode(node));
          } else if (
            mutation.type === 'characterData' &&
            mutation.target.parentElement instanceof HTMLElement
          ) {
            handleNode(mutation.target.parentElement);
          }
        }
      });

      observer.observe(region, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
      });

      // Store observer ref for cleanup
      (window as any).__meetCaptionObserver = observer;

      console.log('[meet-automation] Caption MutationObserver active');
    },
    {
      regionSelector: `${CAPTION_REGION_SELECTOR}, ${CAPTION_REGION_SELECTOR_DE}`,
      bridgeName: BROWSER_BRIDGE_NAME,
      secret: BRIDGE_SECRET,
    },
  );

  observerActive = true;
  logger.info('Caption scraper initialized');
}

/**
 * Stop the MutationObserver and disconnect the bridge.
 */
export async function stopCaptionScraper(page: Page): Promise<void> {
  if (!observerActive) return;

  try {
    await page.evaluate(() => {
      const observer = (window as any).__meetCaptionObserver;
      if (observer) {
        observer.disconnect();
        console.log('[meet-automation] Caption MutationObserver disconnected');
      }
      delete (window as any).__meetCaptionObserver;
      delete (window as any).__meetCaptionObserverActive;
      delete (window as any).__meetCaptionBridge;
    });
  } catch {
    // page might be closed
  }

  observerActive = false;
  logger.info('Caption scraper stopped');
}

/**
 * Convenience: enable captions + start scraping in one call.
 * Returns true if scraping was set up successfully.
 */
export async function startCaptionScraping(page: Page, callback: CaptionCallback): Promise<boolean> {
  const enabled = await enableCaptions(page);
  if (!enabled) {
    logger.warn('Captions could not be enabled — scraping will not start');
    return false;
  }

  await setupCaptionScraper(page, callback);
  return true;
}
