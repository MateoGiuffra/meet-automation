import { Page } from 'playwright';
import { getLogger } from '../logger.js';
import {
  PEOPLE_BUTTON_SELECTOR,
  PEOPLE_PANEL_SELECTOR,
  PEOPLE_LIST_ITEM_SELECTOR,
} from './constants.js';

const logger = getLogger('scraping/participants');

/**
 * Lee el conteo de participantes del badge del botón "People (N)".
 * No requiere abrir el panel — seguro de sondear seguido.
 */
export async function getParticipantCount(page: Page): Promise<number | null> {
  try {
    const label = await page.locator(PEOPLE_BUTTON_SELECTOR).first().getAttribute('aria-label');
    if (!label) return null;
    const match = label.match(/\((\d+)\)/);
    if (!match) return null;
    return Number(match[1]);
  } catch {
    return null;
  }
}

async function isPeoplePanelOpen(page: Page): Promise<boolean> {
  return page
    .locator(PEOPLE_PANEL_SELECTOR)
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
}

async function readParticipantNames(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ panelSelector, itemSelector }) => {
      const panel = document.querySelector(panelSelector);
      if (!panel) return [];
      const items = Array.from(panel.querySelectorAll(itemSelector));
      return items
        .map((item) => (item.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    },
    { panelSelector: PEOPLE_PANEL_SELECTOR, itemSelector: PEOPLE_LIST_ITEM_SELECTOR },
  );
}

/**
 * Chequea si el profe está presente en la llamada.
 *
 * Invasivo: el panel People ocupa el mismo slot lateral que el chat, así que
 * esto abre el panel People (cerrando el de chat si estaba abierto), lee la
 * lista, y devuelve todo al estado anterior. Llamar con poca frecuencia
 * (ver config.monitor.professorCheckIntervalMs), no en cada poll.
 *
 * Devuelve `null` si no se pudo determinar (ej. `professorName` vacío o panel
 * inaccesible) — el caller no debe tratar `null` como "ausente".
 */
export async function checkProfessorPresence(
  page: Page,
  professorName: string,
): Promise<boolean | null> {
  if (!professorName.trim()) return null;

  const chatWasOpen = await page
    .locator('[aria-label*="in-call messages" i]')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);

  try {
    const alreadyOpen = await isPeoplePanelOpen(page);
    if (!alreadyOpen) {
      await page.locator(PEOPLE_BUTTON_SELECTOR).first().click({ timeout: 3000 });
      await page.waitForTimeout(400);
    }

    const opened = await isPeoplePanelOpen(page);
    if (!opened) {
      logger.warn('No se pudo abrir el panel People para chequear presencia del profe');
      return null;
    }

    const names = await readParticipantNames(page);
    const needle = professorName.trim().toLowerCase();
    const present = names.some((name) => name.toLowerCase().includes(needle));

    return present;
  } catch (err) {
    logger.warn('Error chequeando presencia del profe', { error: err });
    return null;
  } finally {
    // Restaurar: si el chat estaba abierto, reabrirlo (esto reemplaza el nodo
    // del contenedor de chat, así que el MutationObserver del chat scraper
    // necesita re-setearse — ver ensureChatPanelOpen en chat.ts).
    if (chatWasOpen) {
      try {
        await page
          .locator('button[aria-label*="chat" i], button[aria-label*="messages" i]')
          .first()
          .click({ timeout: 2000 });
      } catch {
        // best effort
      }
    }
  }
}
