import { Page } from 'playwright';
import { randomBytes } from 'crypto';
import { getLogger } from '../logger.js';
import type { ChatCallback } from './types.js';

const logger = getLogger('scraping/chat');

const BROWSER_BRIDGE_NAME = '__meetChatBridge';
const BRIDGE_SECRET = randomBytes(16).toString('hex');

let observerActive = false;

// ── Chat panel detection ────────────────────────────────────────────────

async function isChatPanelOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (t: string) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (node: Element) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    // Check for message input box (textarea, contenteditable, or textbox)
    const hasMessageBox = Array.from(
      document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'),
    ).some((node) => {
      if (!isVisible(node)) return false;
      const label = normalize(
        node.getAttribute('aria-label') ||
        node.getAttribute('placeholder') ||
        node.getAttribute('title') ||
        '',
      );
      return (
        label.includes('send a message') ||
        label.includes('message everyone') ||
        label.includes('in-call message') ||
        label.includes('chat')
      );
    });

    // Check for close-chat button (indicates panel is open)
    const hasCloseButton = Array.from(document.querySelectorAll('button, [role="button"]')).some((node) => {
      if (!isVisible(node)) return false;
      const label = normalize(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '');
      return label.includes('close chat') || label.includes('close in-call messages');
    });

    return hasMessageBox || hasCloseButton;
  });
}

// ── Open the chat panel ─────────────────────────────────────────────────

async function clickChatButton(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalize = (t: string) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (node: Element) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    const phrases = [
      'chat with everyone',
      'show everyone chat',
      'open chat',
      'in-call messages',
      'messages',
      'chat',
    ];

    for (const phrase of phrases) {
      const node = candidates.find((candidate) => {
        if (!isVisible(candidate)) return false;
        const label = normalize(
          candidate.getAttribute('aria-label') ||
          candidate.getAttribute('title') ||
          candidate.textContent ||
          '',
        );
        return label.includes(phrase);
      });
      if (node) {
        (node as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
}

export async function openChatPanel(page: Page): Promise<boolean> {
  if (await isChatPanelOpen(page)) {
    logger.info('Chat panel already open');
    return true;
  }

  const clicked = await clickChatButton(page);
  if (clicked) {
    logger.info('Chat button clicked, waiting for panel...');
    // Wait for panel to appear
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      if (await isChatPanelOpen(page)) {
        logger.info('Chat panel opened');
        return true;
      }
    }
    logger.warn('Chat panel did not appear after click');
  }

  // Fallback: try keyboard shortcut
  logger.info('Trying keyboard shortcut Ctrl+Alt+C...');
  try {
    await page.keyboard.press('Control+Alt+c');
    await page.waitForTimeout(1000);
    if (await isChatPanelOpen(page)) {
      logger.info('Chat panel opened via keyboard shortcut');
      return true;
    }
  } catch (err) {
    logger.warn('Keyboard shortcut failed', { error: err });
  }

  logger.warn('Could not open chat panel');
  return false;
}

// ── Collect all currently visible messages ───────────────────────────────

async function collectVisibleMessages(page: Page): Promise<Array<{ author: string; text: string; fingerprint: string }>> {
  return page.evaluate(() => {
    const normalize = (t: string) => (t || '').replace(/\s+/g, ' ').trim();
    const isVisible = (node: Element) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const rootSelectors = [
      '[aria-label*="in-call messages" i]',
      '[aria-label*="chat" i]',
      '[role="complementary"]',
    ];
    const messageSelectors = [
      '[role="listitem"]',
      '[data-message-id]',
      'article',
      'li',
    ];

    const roots: Element[] = [];
    for (const selector of rootSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        if (!roots.includes(node)) roots.push(node);
      }
    }

    const collected: Array<{ author: string; text: string; fingerprint: string }> = [];
    const seen = new Set<string>();

    for (const root of roots) {
      const items = messageSelectors.flatMap((sel) => Array.from(root.querySelectorAll(sel)));

      for (const item of items) {
        if (!isVisible(item)) continue;
        const rawText = normalize(item.textContent || '');
        if (!rawText) continue;

        const lines = rawText.split('\n').map((l) => normalize(l)).filter(Boolean);
        if (!lines.length) continue;

        // Try to extract author from data attributes or first line
        const authorNode = (item as HTMLElement).querySelector(
          '[data-sender-name], [data-participant-name]',
        );
        const author = normalize(authorNode?.textContent || lines[0] || '');
        const text = normalize(lines.length > 1 ? lines.slice(1).join(' ') : lines[0]);
        const fingerprint = `${author}|${text}`.toLowerCase();

        if (!text || seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        collected.push({ author, text, fingerprint });
      }
    }

    return collected;
  });
}

// ── Setup the MutationObserver for new messages ──────────────────────────

export async function setupChatScraper(page: Page, callback: ChatCallback): Promise<void> {
  if (observerActive) {
    logger.warn('Chat scraper already active — skipping setup');
    return;
  }

  // First, collect existing messages so we know what's already there
  const existingFingerprints = new Set<string>();
  try {
    const existing = await collectVisibleMessages(page);
    for (const msg of existing) {
      existingFingerprints.add(msg.fingerprint);
    }
    logger.info(`Collected ${existingFingerprints.size} existing chat messages as baseline`);
  } catch {
    logger.warn('Could not collect existing messages for baseline');
  }

  // Expose bridge: browser → Node
  await page.exposeFunction(BROWSER_BRIDGE_NAME, async (author: string, text: string) => {
    const event = { author, text, timestamp: Date.now() };
    try {
      await callback(event);
    } catch (err) {
      logger.error('Chat callback error', { error: err });
    }
  });

  // Inject MutationObserver
  await page.evaluate(
    ({ bridgeName, existingFps }) => {
      if ((window as any).__meetChatObserverActive) return;
      (window as any).__meetChatObserverActive = true;

      const seenFps = new Set(existingFps);

      // Find the chat container
      const rootSelectors = [
        '[aria-label*="in-call messages" i]',
        '[aria-label*="chat" i]',
        '[role="complementary"]',
      ];

      let chatContainer: Element | null = null;
      for (const sel of rootSelectors) {
        chatContainer = document.querySelector(sel);
        if (chatContainer) break;
      }

      if (!chatContainer) {
        console.warn('[meet-automation] Chat container not found for observer');
        return;
      }

      const normalize = (t: string) => (t || '').replace(/\s+/g, ' ').trim();

      const handleNode = (node: Node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!node.isConnected) return;
        // Skip the root container itself
        if (node.getAttribute?.('role') === 'complementary') return;

        const rawText = normalize(node.textContent || '');
        if (!rawText) return;

        const lines = rawText.split('\n').map((l) => normalize(l)).filter(Boolean);
        if (!lines.length) return;

        const authorNode = node.querySelector(
          '[data-sender-name], [data-participant-name]',
        );
        const author = normalize(authorNode?.textContent || lines[0] || '');
        const text = normalize(lines.length > 1 ? lines.slice(1).join(' ') : lines[0]);
        const fingerprint = `${author}|${text}`.toLowerCase();

        if (!text || seenFps.has(fingerprint)) return;
        seenFps.add(fingerprint);

        (window as any)[bridgeName](author, text);
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

      observer.observe(chatContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
      });

      (window as any).__meetChatObserver = observer;
      console.log('[meet-automation] Chat MutationObserver active');
    },
    {
      bridgeName: BROWSER_BRIDGE_NAME,
      existingFps: Array.from(existingFingerprints),
    },
  );

  observerActive = true;
  logger.info('Chat scraper initialized');
}

export async function stopChatScraper(page: Page): Promise<void> {
  if (!observerActive) return;

  try {
    await page.evaluate(() => {
      const observer = (window as any).__meetChatObserver;
      if (observer) {
        observer.disconnect();
        console.log('[meet-automation] Chat MutationObserver disconnected');
      }
      delete (window as any).__meetChatObserver;
      delete (window as any).__meetChatObserverActive;
      delete (window as any).__meetChatBridge;
    });
  } catch {
    // page might be closed
  }

  observerActive = false;
  logger.info('Chat scraper stopped');
}

/**
 * Convenience: open chat + start scraping in one call.
 */
export async function startChatScraping(page: Page, callback: ChatCallback): Promise<boolean> {
  const opened = await openChatPanel(page);
  if (!opened) {
    logger.warn('Chat panel could not be opened — scraping will not start');
    return false;
  }

  await setupChatScraper(page, callback);
  return true;
}

/**
 * Re-abre el panel de chat y re-instala el MutationObserver.
 *
 * Necesario después de que algo (ej. `checkProfessorPresence`) haya abierto
 * el panel People, que reemplaza el nodo del contenedor de chat en el DOM —
 * el observer anterior queda apuntando a un nodo desmontado.
 */
export async function restartChatScraper(page: Page, callback: ChatCallback): Promise<boolean> {
  await stopChatScraper(page);
  return startChatScraping(page, callback);
}
