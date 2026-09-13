import { Page, BrowserContext } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from './config.js';
import { getLogger } from './logger.js';
import { retryActionWithWait } from './resilience.js';
import {
  GOOGLE_REQUEST_DENIED,
  GOOGLE_REQUEST_DENIED_ES,
  GOOGLE_REQUEST_TIMEOUT,
  GOOGLE_REQUEST_TIMEOUT_ES,
  GOOGLE_LOBBY_MODE_HOST_TEXT,
  GOOGLE_LOBBY_MODE_HOST_TEXT_ES,
  JOIN_BUTTON_TEXTS,
  CONTINUE_WITHOUT_DEVICES_TEXTS,
  GOT_IT_TEXTS,
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

// aria-label del botón de salir de la llamada — el único indicador confiable de
// "estamos efectivamente en la llamada" en la UI actual de Meet (el botón "People"
// con conteo no existe más, ver comentario en waitForLobbyOrAdmission).
const LEAVE_CALL_BUTTON_SELECTOR =
  'button[aria-label="Leave call"], button[aria-label="Anruf verlassen"], button[aria-label="Salir de la llamada"]';

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

/**
 * Detecta la pantalla de pre-join en modo invitado (sin sesión de Google
 * activa en el perfil): Meet muestra un link "Sign in"/"Acceder" y pide
 * escribir un nombre a mano — el botón de join queda deshabilitado hasta
 * que se escribe algo ahí. No bloquea el flujo (se sigue como invitado,
 * ver `fillGuestNameIfPresent`), pero deja un warning bien visible porque
 * significa que el clon del perfil se hizo sin sesión de Google — el
 * síntoma real casi siempre es "Chrome estaba abierto al clonar".
 */
async function verifyGoogleSessionActive(page: Page): Promise<void> {
  const signInLink = page.locator('a, button, span').filter({ hasText: /^(sign in|acceder|iniciar sesión)$/i }).first();
  const isGuestMode = await signInLink.isVisible({ timeout: 2000 }).catch(() => false);

  if (!isGuestMode) return;

  await saveDebugScreenshot(page, 'guest-mode-no-session');
  logger.warn(
    'El perfil no tiene sesión de Google activa — Meet muestra la pantalla de invitado. ' +
    'Se va a seguir como invitado con MEET_DISPLAY_NAME. Si esperabas entrar logueado, ' +
    're-cloná el perfil con Chrome COMPLETAMENTE cerrado (robocopy no puede copiar Cookies/Login Data ' +
    'si Chrome está corriendo) — ver README.',
  );
}

/**
 * En modo invitado, Meet pide un nombre antes de habilitar "Join now"/
 * "Unirse ahora". Lo completa con `config.meetDisplayName` si el campo
 * está visible y vacío. No-op si el perfil está logueado (el input no
 * aparece) o si ya tiene texto.
 */
async function fillGuestNameIfPresent(page: Page): Promise<void> {
  const nameInput = page.locator('input[type="text"]').first();
  const isVisible = await nameInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (!isVisible) return;

  const currentValue = await nameInput.inputValue().catch(() => '');
  if (currentValue.trim()) return;

  await nameInput.fill(config.meetDisplayName);
  logger.info('Nombre de invitado completado', { name: config.meetDisplayName });
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

/**
 * Extrae el texto de un selector `button[aria-label^="..." i]` y chequea si
 * `ariaLabel` empieza con ese texto (case-insensitive) — mismo criterio que
 * el selector CSS `^=`, pero evaluado en JS contra un valor ya leído.
 */
function matchesAriaLabelSelector(selector: string, ariaLabel: string): boolean {
  const match = selector.match(/\^="([^"]+)"/);
  if (!match) return false;
  return ariaLabel.toLowerCase().startsWith(match[1].toLowerCase());
}

async function disableMicAndCamera(page: Page): Promise<void> {
  const clickedDevices = await clickContinueWithoutDevicesIfPresent(page);
  if (clickedDevices) {
    logger.info('Mic/cámara ya apagados via "Continue without devices"');
    return;
  }

  logger.info('Perfil con permisos — buscando toggles de mic/cámara...');

  // Con varios micrófonos/cámaras conectados, Meet agrega pills de selección
  // de dispositivo (ej. "e2eSoft iVCam ▲") cuyo aria-label también puede
  // contener "Cam"/"Mic" — un selector suelto como `*="Cam" i` las agarra en
  // vez del botoncito redondo de apagar/prender, abre el dropdown de
  // selección, y todo lo que viene después se cuelga esperando algo que
  // nunca pasa. Por eso acá se usa `^=` (empieza con) contra los aria-label
  // reales del toggle, separando explícitamente "está prendido, hay que
  // apagarlo" de "ya está apagado" — antes esto se adivinaba buscando la
  // palabra "off" adentro del label, que también aparece en "Turn OFF
  // camera" (o sea, cuando está PRENDIDA), dando falsos "confirmado apagado".
  const micOnSelectors = [
    'button[aria-label^="Turn off microphone" i]',
    'button[aria-label^="Desactivar micrófono" i]',
    'button[aria-label^="Mute" i]',
  ];
  const micOffSelectors = [
    'button[aria-label^="Turn on microphone" i]',
    'button[aria-label^="Activar micrófono" i]',
    'button[aria-label^="Unmute" i]',
  ];
  const camOnSelectors = [
    'button[aria-label^="Turn off camera" i]',
    'button[aria-label^="Desactivar cámara" i]',
  ];
  const camOffSelectors = [
    'button[aria-label^="Turn on camera" i]',
    'button[aria-label^="Activar cámara" i]',
  ];

  // Si quedó abierto un dropdown de selección de dispositivo (por una corrida
  // anterior fallida, o porque Meet lo abre solo si hay más de una cámara),
  // Escape lo cierra sin tocar el estado de mic/cámara.
  await page.keyboard.press('Escape').catch(() => {});

  // `locator.isVisible({ timeout })` NO espera de verdad — es un chequeo puntual,
  // el `timeout` no bloquea (ver docs de Playwright: "resolves after actionability
  // checks, regardless of timeout"). Dos de estos chequeos secuenciales justo
  // después de un click pueden caer en el instante exacto en que React está
  // re-renderizando el botón (aria-label momentáneamente ausente de ambos sets),
  // dando "ni on ni off visible" → UNKNOWN, aunque el estado real ya cambió. Por
  // eso acá se usa `waitFor` (que sí espera) sobre el selector combinado, y se lee
  // el aria-label final una sola vez en vez de comparar visibilidad de a pares.
  const ensureDeviceOff = async (
    deviceName: string,
    onSelectors: string[],
    offSelectors: string[],
  ): Promise<boolean> => {
    const combinedSelector = [...onSelectors, ...offSelectors].join(', ');

    for (const sel of onSelectors) {
      const btn = page.locator(sel).first();
      const isVisible = await btn.isVisible().catch(() => false);
      if (!isVisible) continue;

      await btn.click().catch(() => {});
      logger.info(`${deviceName} clickeado para apagar`, { selector: sel });
      break;
    }

    try {
      const toggle = page.locator(combinedSelector).first();
      await toggle.waitFor({ state: 'visible', timeout: 3000 });

      // El click ya salió, pero el toggle puede tardar un instante más en
      // reflejar el nuevo aria-label (re-render de React) — reintentar la
      // lectura unas cuantas veces en vez de confiar en una sola, que puede
      // caer justo en medio de la transición y leer el estado viejo.
      let lastAriaLabel = '';
      for (let attempt = 0; attempt < 6; attempt++) {
        lastAriaLabel = (await toggle.getAttribute('aria-label').catch(() => null)) ?? '';

        if (offSelectors.some((sel) => matchesAriaLabelSelector(sel, lastAriaLabel))) return true;
        if (!onSelectors.some((sel) => matchesAriaLabelSelector(sel, lastAriaLabel))) break;

        await page.waitForTimeout(300);
      }

      logger.warn(`${deviceName}: no se confirmó apagado tras reintentos`, { ariaLabel: lastAriaLabel });
      return false;
    } catch {
      // Ningún toggle visible (sin permiso de dispositivo, o ya lo manejó
      // "Continue without devices" antes) — no hay nada prendido que apagar.
      return true;
    }
  };

  const micConfirmedOff = await ensureDeviceOff('Micrófono', micOnSelectors, micOffSelectors);
  const camConfirmedOff = await ensureDeviceOff('Cámara', camOnSelectors, camOffSelectors);

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
  let tick = 0;

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
      tick++;
      // Screenshot cada ~10s mientras se espera admisión — para poder ver el
      // estado en vivo (config.debugScreenshotsDir) sin matar el proceso.
      if (tick % 5 === 0) void saveDebugScreenshot(page, 'lobby-wait');

      try {
        const bodyHasBlockedText = await page.evaluate(() =>
          document.body.innerText.includes("You can't join this video call") ||
          document.body.innerText.includes('No puedes unirte a esta videollamada'),
        ).catch(() => false);
        if (bodyHasBlockedText) {
          resolved = true;
          clearInterval(interval);
          clearTimeout(timeout);
          await saveDebugScreenshot(page, 'blocked-cant-join');
          reject(new MeetAutomationError(
            'Google bloqueó el join ("You can\'t join this video call") antes de llegar al host — típico de detección de browser automatizado, no de un rechazo humano.',
          ));
          return;
        }

        const currentUrl = page.url();
        if (!currentUrl.includes('meet.google.com')) {
          resolved = true;
          clearInterval(interval);
          clearTimeout(timeout);
          await saveDebugScreenshot(page, 'redirected-away');
          reject(new MeetAutomationError(`Redirigido fuera de Meet: ${currentUrl}`));
          return;
        }

        // El botón "People" con conteo en el aria-label (ej. "People (12)") no existe
        // en la versión actual de Meet — el badge de participantes es un ícono sin
        // aria-label. El único indicador confiable de "ya estamos en la llamada" es
        // el botón de salir.
        const leaveButton = await page
          .locator(LEAVE_CALL_BUTTON_SELECTOR)
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false);

        if (leaveButton) {
          for (const text of [GOOGLE_LOBBY_MODE_HOST_TEXT, GOOGLE_LOBBY_MODE_HOST_TEXT_ES, 'Bitte warten Sie, bis Sie vom Organisator']) {
            const lobbyText = await page.getByText(text);
            if ((await lobbyText.count()) > 0 && (await lobbyText.first().isVisible())) {
              logger.info('Esperando a que el host admita...');
              return;
            }
          }

          for (const text of [GOOGLE_REQUEST_TIMEOUT, GOOGLE_REQUEST_TIMEOUT_ES, 'Niemand hat auf Ihre Teilnahmeanfrage geantwortet']) {
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
              bodyText.includes('people in the call') ||
              bodyText.includes('Te has unido a la llamada') ||
              bodyText.includes('otra persona en la llamada') ||
              bodyText.includes('personas en la llamada')
            ) return true;

            const leaveBtn = document.querySelector(
              'button[aria-label="Leave call"], button[aria-label="Anruf verlassen"], button[aria-label="Salir de la llamada"]',
            );
            if (leaveBtn) {
              const hasLobbyText =
                bodyText.includes('Asking to join') ||
                bodyText.includes('Teilnahme erbitten') ||
                bodyText.includes('Solicitando unirte') ||
                bodyText.includes('Pidiendo unirte');
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

        for (const text of [GOOGLE_REQUEST_DENIED, GOOGLE_REQUEST_DENIED_ES]) {
          const deniedText = await page.getByText(text);
          if ((await deniedText.count()) > 0 && (await deniedText.first().isVisible())) {
            resolved = true;
            clearInterval(interval);
            clearTimeout(timeout);
            reject(new JoinRequestDeniedError());
            return;
          }
        }
      } catch {
        // continue polling
      }
    }, 2000);
  });
}

async function dismissModals(page: Page): Promise<void> {
  try {
    const gotItPattern = new RegExp(`^(${GOT_IT_TEXTS.join('|')})$`, 'i');
    const gotItButton = page.locator('button').filter({ hasText: gotItPattern }).first();
    const hasGotIt = await gotItButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasGotIt) return;

    logger.info('Dismissando modales "Got it"...');
    let clicked = 0;
    let prevCount = -1;
    let noChangeCount = 0;

    while (true) {
      const buttons = await page.locator(`button:visible`).filter({ hasText: gotItPattern }).all();
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
    const btn = page.locator(LEAVE_CALL_BUTTON_SELECTOR).first();
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
  await verifyGoogleSessionActive(page);
  await fillGuestNameIfPresent(page);

  await disableMicAndCamera(page);

  await clickJoinButton(page);

  await clickContinueWithoutDevicesIfPresent(page);

  await waitForLobbyOrAdmission(page);

  await dismissModals(page);
  await dismissDeviceNotifications(page);

  logger.info('✅ Unido al Meet exitosamente. El browser queda abierto.');
}
