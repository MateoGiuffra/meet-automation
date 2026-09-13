import { Page, BrowserContext } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getLogger } from './logger.js';
import { retryActionWithWait } from './resilience.js';
import {
  GOOGLE_REQUEST_DENIED,
  GOOGLE_REQUEST_TIMEOUT,
  GOOGLE_LOBBY_MODE_HOST_TEXT,
  JOIN_BUTTON_TEXTS,
  CONTINUE_WITHOUT_DEVICES_TEXTS,
  GOT_IT_TEXT,
  SIGN_IN_URL_PREFIX,
  DEVICE_NOTIFICATION_TEXTS,
} from './constants.js';
import {
  MeetAutomationError,
  ProfileNotLoggedInError,
  LobbyTimeoutError,
  JoinRequestDeniedError,
  DeviceToggleError,
} from './errors.js';

const logger = getLogger('meet');

async function saveDebugScreenshot(page: Page, label: string): Promise<void> {
  try {
    await mkdir(config.debugScreenshotsDir, { recursive: true });
    const filename = `${Date.now()}-${label}.png`;
    const filepath = join(config.debugScreenshotsDir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    logger.info(`Screenshot guardado: ${filepath}`);
  } catch (err) {
    logger.warn('No se pudo guardar screenshot de debug', { error: err });
  }
}

async function verifyOnMeetPage(page: Page): Promise<void> {
  const url = page.url();

  if (url.startsWith(SIGN_IN_URL_PREFIX)) {
    logger.error('El perfil no está logueado — caído en pantalla de sign-in de Google');
    throw new ProfileNotLoggedInError();
  }

  if (!url.includes('meet.google.com')) {
    logger.error('No se detectó la página de Google Meet', { currentUrl: url });
    throw new ProfileNotLoggedInError('La URL no parece ser un Meet de Google');
  }

  logger.info('Página de Google Meet verificada correctamente');
}

async function clickContinueWithoutDevicesIfPresent(page: Page): Promise<boolean> {
  for (const text of CONTINUE_WITHOUT_DEVICES_TEXTS) {
    try {
      const button = page.locator('button').filter({ hasText: new RegExp(text, 'i') }).first();
      const isVisible = await button.isVisible({ timeout: 3000 }).catch(() => false);
      if (isVisible) {
        logger.info('Botón "Continue without devices" encontrado, clickeando...');
        await button.click();
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

async function disableMicAndCamera(page: Page): Promise<void> {
  const clickedDevices = await clickContinueWithoutDevicesIfPresent(page);
  if (clickedDevices) {
    logger.info('Mic/cámara ya apagados via "Continue without devices"');
    return;
  }

  logger.info('Perfil con permisos — buscando toggles de mic/cámara...');

  const micSelectors = [
    'button[aria-label*="microphone" i]',
    'button[aria-label*="Turn off microphone" i]',
    'button[aria-label*="Mute" i]',
    'button[aria-label*="Mic" i]',
  ];

  const camSelectors = [
    'button[aria-label*="camera" i]',
    'button[aria-label*="Turn off camera" i]',
    'button[aria-label*="Video" i]',
    'button[aria-label*="Cam" i]',
  ];

  for (const sel of micSelectors) {
    try {
      const btn = page.locator(sel).first();
      const isVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!isVisible) continue;

      const ariaLabel = await btn.getAttribute('aria-label') ?? '';
      const isOn = /turn off|muted/i.test(ariaLabel) || !/off|muted/i.test(ariaLabel);
      if (isOn) {
        await btn.click();
        logger.info('Micrófono clickeado para apagar', { ariaLabel });
        await page.waitForTimeout(500);
      } else {
        logger.info('Micrófono ya estaba apagado', { ariaLabel });
      }
      break;
    } catch {
      // try next selector
    }
  }

  for (const sel of camSelectors) {
    try {
      const btn = page.locator(sel).first();
      const isVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!isVisible) continue;

      const ariaLabel = await btn.getAttribute('aria-label') ?? '';
      const isOn = /turn off/i.test(ariaLabel) || !/off|muted/i.test(ariaLabel);
      if (isOn) {
        await btn.click();
        logger.info('Cámara clickeada para apagar', { ariaLabel });
        await page.waitForTimeout(500);
      } else {
        logger.info('Cámara ya estaba apagada', { ariaLabel });
      }
      break;
    } catch {
      // try next selector
    }
  }

  let micConfirmedOff = false;
  let camConfirmedOff = false;

  for (const sel of micSelectors) {
    try {
      const btn = page.locator(sel).first();
      const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
      if (!isVisible) {
        micConfirmedOff = true;
        break;
      }
      const label = await btn.getAttribute('aria-label') ?? '';
      if (/off|muted/i.test(label)) {
        micConfirmedOff = true;
        break;
      }
    } catch {
      // continue
    }
  }

  for (const sel of camSelectors) {
    try {
      const btn = page.locator(sel).first();
      const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
      if (!isVisible) {
        camConfirmedOff = true;
        break;
      }
      const label = await btn.getAttribute('aria-label') ?? '';
      if (/off|muted/i.test(label)) {
        camConfirmedOff = true;
        break;
      }
    } catch {
      // continue
    }
  }

  logger.info('Estado final de dispositivos', { micConfirmedOff, camConfirmedOff });

  if (!micConfirmedOff || !camConfirmedOff) {
    await saveDebugScreenshot(page, 'device-toggle-failed');
    throw new DeviceToggleError(
      `No se pudo confirmar estado apagado — mic: ${micConfirmedOff ? 'off' : 'UNKNOWN'}, cam: ${camConfirmedOff ? 'off' : 'UNKNOWN'}`,
    );
  }
}

async function clickJoinButton(page: Page): Promise<void> {
  await retryActionWithWait(
    'Click "Ask to join" / "Join now"',
    async () => {
      for (const text of JOIN_BUTTON_TEXTS) {
        try {
          const clicked = await page.evaluate((buttonText) => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const button = buttons.find((el) => {
              const rect = el.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              return visible && !el.disabled &&
                (el.innerText || '').toLowerCase().includes(buttonText.toLowerCase());
            });
            if (!button) return false;
            button.click();
            return true;
          }, text);

          if (clicked) {
            logger.info(`Join button clickeado via "${text}"`);
            return;
          }

          const locator = page.locator('button', { hasText: new RegExp(text, 'i') }).first();
          if (
            await locator.isVisible({ timeout: 3000 }).catch(() => false) &&
            await locator.isEnabled({ timeout: 3000 }).catch(() => false)
          ) {
            await locator.click({ timeout: 5000 });
            logger.info(`Join button clickeado via locator "${text}"`);
            return;
          }
        } catch {
          // try next text
        }
      }
      throw new Error('No se encontró ningún botón de join visible');
    },
    logger,
    config.maxJoinAttempts,
    config.retryWaitMs,
    async () => {
      await saveDebugScreenshot(page, 'join-button-click-failed');
    },
  );
}

async function waitForLobbyOrAdmission(page: Page): Promise<void> {
  const timeoutMs = config.lobbyTimeoutMinutes * 60 * 1000;

  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(interval);
        saveDebugScreenshot(page, 'lobby-timeout');
        reject(new LobbyTimeoutError());
      }
    }, timeoutMs);

    const interval = setInterval(async () => {
      if (resolved) return;

      try {
        const currentUrl = page.url();
        if (!currentUrl.includes('meet.google.com')) {
          resolved = true;
          clearInterval(interval);
          clearTimeout(timeout);
          await saveDebugScreenshot(page, 'redirected-away');
          reject(new MeetAutomationError(`Redirigido fuera de Meet: ${currentUrl}`));
          return;
        }

        const peopleButton = await page
          .locator('button[aria-label^="People"], button[aria-label^="Personen"]')
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);

        const leaveButton = await page
          .locator('button[aria-label="Leave call"], button[aria-label="Anruf verlassen"]')
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);

        if (peopleButton || leaveButton) {
          for (const text of [GOOGLE_LOBBY_MODE_HOST_TEXT, 'Bitte warten Sie, bis Sie vom Organisator']) {
            const lobbyText = await page.getByText(text);
            if ((await lobbyText.count()) > 0 && (await lobbyText.first().isVisible())) {
              logger.info('Esperando a que el host admita...');
              return;
            }
          }

          for (const text of [GOOGLE_REQUEST_TIMEOUT, 'Niemand hat auf Ihre Teilnahmeanfrage geantwortet']) {
            const timeoutText = await page.getByText(text);
            if ((await timeoutText.count()) > 0 && (await timeoutText.first().isVisible())) {
              resolved = true;
              clearInterval(interval);
              clearTimeout(timeout);
              reject(new LobbyTimeoutError('La solicitud de join expiró'));
              return;
            }
          }

          const participantDetected = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            if (
              bodyText.includes('You have joined the call') ||
              bodyText.includes('other person in the call') ||
              bodyText.includes('people in the call')
            ) return true;

            const leaveBtn = document.querySelector(
              'button[aria-label="Leave call"], button[aria-label="Anruf verlassen"]',
            );
            if (leaveBtn) {
              const hasLobbyText = bodyText.includes('Asking to join') || bodyText.includes('Teilnahme erbitten');
              if (!hasLobbyText) return true;
            }

            return false;
          });

          if (participantDetected) {
            resolved = true;
            clearInterval(interval);
            clearTimeout(timeout);
            logger.info('Admitido en la llamada');
            resolve();
            return;
          }

          logger.info('Botón dePeople/Leave encontrado, esperando confirmación...');
          return;
        }

        const deniedText = await page.getByText(GOOGLE_REQUEST_DENIED);
        if ((await deniedText.count()) > 0 && (await deniedText.isVisible())) {
          resolved = true;
          clearInterval(interval);
          clearTimeout(timeout);
          reject(new JoinRequestDeniedError());
          return;
        }
      } catch {
        // continue polling
      }
    }, 2000);
  });
}

async function dismissModals(page: Page): Promise<void> {
  try {
    const gotItButton = page.locator(`button:has-text("${GOT_IT_TEXT}")`).first();
    const hasGotIt = await gotItButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasGotIt) return;

    logger.info('Dismissando modales "Got it"...');
    let clicked = 0;
    let prevCount = -1;
    let noChangeCount = 0;

    while (true) {
      const buttons = await page.locator(`button:visible`, { hasText: GOT_IT_TEXT }).all();
      const count = buttons.length;
      if (count === 0) break;
      if (count === prevCount) {
        noChangeCount++;
        if (noChangeCount >= 2) break;
      } else {
        noChangeCount = 0;
      }
      prevCount = count;

      for (const btn of buttons) {
        try {
          await btn.click({ timeout: 3000 });
          clicked++;
          await page.waitForTimeout(300);
        } catch {
          // already dismissed
        }
      }
      await page.waitForTimeout(300);
    }
    if (clicked > 0) logger.info(`Modales "Got it" clickeados: ${clicked}`);
  } catch {
    // modals might not exist
  }
}

async function dismissDeviceNotifications(page: Page): Promise<void> {
  try {
    const hasNotification = await page.evaluate((texts) => {
      const bodyText = document.body.innerText;
      return texts.some((t) => bodyText.includes(t));
    }, DEVICE_NOTIFICATION_TEXTS);

    if (!hasNotification) return;

    logger.info('Notificación de dispositivo detectada, intentando dismiss...');
    const closed = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      let count = 0;
      for (const btn of buttons) {
        const label = btn.getAttribute('aria-label') ?? '';
        const hasSvg = btn.querySelector('svg') !== null;
        const isClose =
          label.toLowerCase().includes('close') ||
          label.toLowerCase().includes('dismiss') ||
          (hasSvg && btn.offsetParent !== null && btn.innerText === '');
        if (isClose && btn.offsetParent !== null) {
          btn.click();
          count++;
        }
      }
      return count;
    });
    if (closed > 0) {
      logger.info(`Notificaciones dismissadas: ${closed}`);
      await page.waitForTimeout(1000);
    }
  } catch {
    // ignore
  }
}

export interface JoinResult {
  context: BrowserContext;
  page: Page;
}

/**
 * Sale de la llamada clickeando "Leave call". Único punto de salida —
 * tanto el cierre manual (Ctrl+C) como la tool `leave_call` del juez LLM
 * deben pasar por acá, no cerrar el context directamente.
 */
export async function leaveMeeting(page: Page): Promise<void> {
  try {
    const btn = page.locator('button[aria-label="Leave call"], button[aria-label="Anruf verlassen"]').first();
    const isVisible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await btn.click({ timeout: 3000 });
      logger.info('Salió de la llamada (Leave call)');
      return;
    }
    logger.warn('Botón "Leave call" no visible — probablemente ya no estamos en la llamada');
  } catch (err) {
    logger.warn('Error al intentar salir de la llamada', { error: err });
  }
}

export async function joinMeet(page: Page, context: BrowserContext): Promise<void> {
  logger.info('Navegando a Google Meet...', { url: config.meetUrl });
  await page.goto(config.meetUrl, { waitUntil: 'domcontentloaded' });

  try {
    await clickContinueWithoutDevicesIfPresent(page);
    await page.locator('input[type="text"]').first().waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    logger.info('Botón de pre-join no encontrado o no necesario');
  }

  await verifyOnMeetPage(page);

  await disableMicAndCamera(page);

  await clickJoinButton(page);

  await clickContinueWithoutDevicesIfPresent(page);

  await waitForLobbyOrAdmission(page);

  await dismissModals(page);
  await dismissDeviceNotifications(page);

  logger.info('✅ Unido al Meet exitosamente. El browser queda abierto.');
}
