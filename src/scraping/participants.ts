import { Page } from 'playwright';
import { getLogger } from '../logger.js';
import {
  PEOPLE_BUTTON_SELECTOR,
  PEOPLE_BUTTON_TEXT_PREFIXES,
  PEOPLE_PANEL_SELECTOR,
  PEOPLE_LIST_ITEM_SELECTOR,
} from './constants.js';

const logger = getLogger('scraping/participants');

/**
 * Ubica el botón/ícono de participantes por texto (ej. "Personas2"), no por
 * aria-label — la versión actual de Meet lo renderiza como un
 * `<div role="button">` sin aria-label, con el label y el conteo pegados en
 * el textContent. `PEOPLE_BUTTON_SELECTOR` (aria-label) queda como fallback
 * de una sola pasada por si alguna variante de Meet sí lo expone así.
 */
async function findPeopleButtonText(page: Page): Promise<string | null> {
  return page.evaluate((prefixes) => {
    const candidates = Array.from(document.querySelectorAll('[role="button"]'));
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      for (const prefix of prefixes) {
        if (text.toLowerCase().startsWith(prefix.toLowerCase())) return text;
      }
    }
    return null;
  }, PEOPLE_BUTTON_TEXT_PREFIXES);
}

/**
 * Lee el conteo de participantes del badge del botón de personas (ej.
 * "Personas2" → 2). No requiere abrir el panel — seguro de sondear seguido.
 */
export async function getParticipantCount(page: Page): Promise<number | null> {
  try {
    const text = await findPeopleButtonText(page);
    if (text) {
      const match = text.match(/(\d+)\s*$/);
      if (match) return Number(match[1]);
    }

    // Fallback: aria-label con formato "People (N)".
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

// `PEOPLE_PANEL_SELECTOR` ahora apunta al buscador de adentro del panel (ver
// constants.ts) — no es un contenedor con hijos, así que no sirve para
// scopear el querySelectorAll de la lista. Con el panel ya confirmado
// abierto (isPeoplePanelOpen), basta con buscar los listitem en todo el
// documento: no hay otro `[role="listitem"]` compitiendo en pantalla mientras
// este panel está abierto.
async function readParticipantNames(page: Page): Promise<string[]> {
  return page.evaluate((itemSelector) => {
    const items = Array.from(document.querySelectorAll(itemSelector));
    return items
      .map((item) => (item.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }, PEOPLE_LIST_ITEM_SELECTOR);
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
      // `force: true` porque el botón de Personas dispara un tooltip/ripple al
      // hacer hover que Playwright interpreta como "elemento inestable" y
      // aborta el click esperando que se asiente — nunca lo hace del todo.
      const text = await findPeopleButtonText(page);
      if (text) {
        await page
          .locator('[role="button"]')
          .filter({ hasText: text })
          .first()
          .click({ timeout: 3000, force: true });
      } else {
        await page.locator(PEOPLE_BUTTON_SELECTOR).first().click({ timeout: 3000, force: true });
      }
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
