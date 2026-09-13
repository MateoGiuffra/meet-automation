import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';
import { config } from './config.js';
import { getLogger } from './logger.js';

const logger = getLogger('browser');

// El stealth plugin de puppeteer-extra parchea navigator.webdriver, chrome.runtime,
// permissions.query, plugins/mimeTypes, WebGL vendor/renderer, etc. — todo lo que
// Google usa server-side para detectar un browser controlado por CDP. Parchear
// solo navigator.webdriver a mano (como hacía la versión anterior) no alcanza:
// Meet igual detectaba el bot y devolvía "You can't join this video call" apenas
// se apretaba join, sin que nadie del lado humano rechazara nada.
const stealthPlugin = StealthPlugin();
// Estas dos evasions rompen más de lo que arreglan en casos reales (iframe.contentWindow
// puede colgar la carga de ciertos iframes; media.codecs no aporta nada en Meet) —
// mismo ajuste que hace el repo de referencia meeting-bot.
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('media.codecs');
chromium.use(stealthPlugin);

// ── Flags validas para Windows (Chromium) ───────────────────────────
// Fuente: chrome-launcher defaults + chromium/common/chrome_switches.cc
// IMPORTANTE: --no-sandbox y --disable-setuid-sandbox son SOLO Linux.
const FIRST_RUN_SUPPRESSION_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-default-apps',
];

export interface BrowserResult {
  context: BrowserContext;
  page: Page;
}

/**
 * Cierra Chrome de forma prolija.
 *
 * `context.close()` en un `launchPersistentContext` sí mata el proceso de Chrome
 * (a diferencia de la versión anterior por CDP, donde `browser.close()` no hacía
 * nada real porque el proceso no era propiedad de Playwright). Como Playwright lo
 * lanzó, también lo cierra bien — no hace falta taskkill manual.
 */
export async function closeBrowserGracefully(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch (err) {
    logger.warn('Error cerrando el browser', { error: err });
  }
}

/**
 * Lanza Chrome con el profile clonado vía `launchPersistentContext` de Playwright,
 * con el plugin stealth aplicado (evasions de detección de automatización) y sin
 * los flags de automatización por defecto de Playwright (`ignoreDefaultArgs`).
 *
 * Antes esto lanzaba Chrome como proceso aparte y conectaba por CDP — la idea era
 * evitar que Playwright "se note", pero Playwright igual controla la página por
 * CDP en ambos casos, así que no cambiaba nada de fondo y sumaba complejidad
 * (spawn manual, taskkill, espera de puerto de debugging). El fix real era el
 * stealth plugin, no el mecanismo de lanzamiento.
 */
export async function launchBrowser(): Promise<BrowserResult> {
  const size = { width: config.browserWidth, height: config.browserHeight };
  const windowSize = { width: size.width, height: size.height + 80 };

  logger.info('Lanzando Chrome con profile persistente + stealth', {
    userDataDir: config.chromeUserDataDir,
    profileDirectory: config.chromeProfileDirectory,
    executablePath: config.chromePath,
  });

  const context = await chromium.launchPersistentContext(config.chromeUserDataDir, {
    headless: false,
    executablePath: config.chromePath,
    viewport: size,
    // CRÍTICO: si Playwright instala sus propios handlers de señal, mata Chrome
    // de un hachazo (TerminateProcess) apenas llega SIGINT/SIGTERM/SIGHUP, sin
    // esperar a que termine de flushear `Cookies`/`Login Data` (SQLite) — eso
    // corrompe el perfil y la sesión de Google se pierde a partir de la
    // segunda corrida. El cierre real tiene que pasar SIEMPRE por
    // closeBrowserGracefully() (nuestro propio handler en index.ts), nunca por
    // el de Playwright.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      `--profile-directory=${config.chromeProfileDirectory}`,
      `--lang=${config.chromeLanguage}`,
      ...FIRST_RUN_SUPPRESSION_ARGS,
      `--window-size=${windowSize.width},${windowSize.height}`,
    ],
    ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
  }) as unknown as BrowserContext;

  // Refuerzo del --lang: por si alguna request no hereda el Accept-Language
  // del proceso (ej. ya había una sesión de idioma guardada en el profile).
  await context.setExtraHTTPHeaders({ 'Accept-Language': `${config.chromeLanguage},en;q=0.9` });

  // El profile tiene "Continuar donde lo dejaste" activo — Chrome restaura las
  // pestañas de la sesión anterior al lanzar, lo que puede traer de vuelta una
  // pestaña de Meet TODAVÍA en la llamada (si la corrida anterior no cerró bien).
  // Navegar sobre esa pestaña con page.goto() dispara el diálogo nativo "¿Salir
  // del sitio?" de Meet, que Playwright no puede confirmar solo — se cuelga para
  // siempre. Por eso siempre se arranca de una pestaña 100% nueva y se cierran
  // todas las que Chrome haya restaurado.
  const restoredPages = context.pages();
  const page = await context.newPage();
  await page.setViewportSize(size);
  await Promise.all(restoredPages.map((p) => p.close().catch(() => {})));

  // Red de seguridad: si en algún punto se navega sobre una pestaña con una
  // llamada activa (ej. por un bug futuro), auto-aceptar cualquier diálogo
  // nativo evita que el proceso quede colgado indefinidamente.
  page.on('dialog', (dialog) => {
    logger.warn('Diálogo nativo del browser detectado — auto-aceptando', { message: dialog.message() });
    dialog.accept().catch(() => {});
  });

  logger.info('Browser lanzado y listo');
  return { context, page };
}
