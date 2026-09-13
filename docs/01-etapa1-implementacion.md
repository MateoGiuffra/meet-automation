# Etapa 1 — instructivo de implementación

> **Progreso**: Todos los items implementados. Ver checklist abajo.

## 0. Setup del proyecto

- `pnpm init -y`, TypeScript + `ts-node` o `tsx` para correr sin compilar, `playwright` (no hace
  falta `playwright-extra` + stealth plugin salvo que Meet empiece a bloquear — evaluar si hace
  falta; `meeting-bot` lo usa en
  `screenappai/meeting-bot\src\lib\chromium.ts` líneas 1-10, pero para un
  perfil real logueado del usuario, con historial y cookies reales, probablemente no se necesite
  fingerprint evasion).
- No usar `playwright test` / `playwright.config.ts` — esto es un script de automatización, no una
  suite de tests.
- Seguir las convenciones de `screenappai/meeting-bot\CLAUDE.MD` en lo que
  aplique a un proyecto standalone (TypeScript estricto, camelCase/PascalCase, early returns,
  logger en vez de `console.log` suelto, manejo de errores con clases custom si suma claridad) —
  no hace falta el resto (arquitectura de bots/servicios/colas, esa es para el otro repo).

## 1. Clonar el perfil de Chrome

Antes de tocar código: copiar el `User Data` de Chrome (o un profile específico dentro de él) a un
directorio nuevo que Playwright pueda usar sin pisar el Chrome real del usuario mientras corre el
bot. En Windows el profile real vive típicamente en
`%LOCALAPPDATA%\Google\Chrome\User Data`. Documentar en el `README.md` de este proyecto el comando
exacto usado para clonarlo (robocopy/xcopy) — no hardcodear un path personal en el código, usar una
variable de entorno.

Verificar el clon: lanzar Chrome manualmente con `--user-data-dir=<clon>` y confirmar que la sesión
de Google ya está logueada (si no lo está, `verifyItIsOnGoogleMeetPage` del repo de referencia,
`screenappai/meeting-bot\src\bots\GoogleMeetBot.ts` líneas 125-151, va a
detectar la página de sign-in — replicar esa detección para fallar con un mensaje claro en vez de
colgarse).

## 2. Función de lanzamiento del browser

Adaptar (no copiar 1:1) el bloque de perfil persistente de
`screenappai/meeting-bot\src\lib\chromium.ts` líneas 241-272:

- `chromium.launchPersistentContext(userDataDir, { headless: false, args: [...], ignoreDefaultArgs, executablePath })`.
- Mantener `firstRunSuppressionArgs` (líneas 134-140 del archivo de referencia).
- Repensar `googleBrowserArgs` (líneas 142-149): sacar los flags de tab-capture/autoplay que son
  para grabación (`--auto-accept-this-tab-capture`, `--autoplay-policy=no-user-gesture-required`),
  ya que Etapa 1 no graba.
- `executablePath`: en Windows, apuntar al Chrome real del usuario (ej.
  `C:\Program Files\Google\Chrome\Application\chrome.exe`), vía variable de entorno.

## 3. Scheduling por ventana horaria

Esto no existe en `meeting-bot` — es la parte 100% nueva de este proyecto. Diseño simple sugerido:

- Config con: URL del Meet, fecha, hora de inicio de ventana (10:00), hora de fin de ventana
  (12:00), nombre a mostrar en Meet.
- Si se ejecuta el script y todavía no llegó la hora de inicio: esperar (setTimeout hasta la hora
  exacta, no polling agresivo) y recién ahí lanzar el join.
- Si ya pasó la hora de fin de la ventana: no intentar entrar, loggear y salir.
- Si estamos dentro de la ventana: joinear ya.
- Dejar el diseño simple (un solo evento, un solo Meet) — no hace falta un scheduler general tipo
  cron para esto todavía.

## 4. Lógica de join (adaptada de GoogleMeetBot)

Referencia completa en
[02-referencias-meeting-bot.md](02-referencias-meeting-bot.md#2-lógica-de-join--selectors-de-google-meet).
Reutilizar de `screenappai/meeting-bot\src\bots\GoogleMeetBot.ts`:

1. `verifyItIsOnGoogleMeetPage` (líneas 125-151) — para detectar perfil no logueado y fallar claro.
2. El llenado de nombre + click "Ask to join" con reintentos (líneas 194-282) — copiar junto con
   `retryActionWithWait` de
   `screenappai/meeting-bot\src\util\resilience.ts`.
3. El loop de espera en lobby (líneas 295-526) — copiar junto con las constantes de
   `screenappai/meeting-bot\src\constants\index.ts`
   (`GOOGLE_LOBBY_MODE_HOST_TEXT`, `GOOGLE_REQUEST_DENIED`, `GOOGLE_REQUEST_TIMEOUT`).
4. Dismissal de modales "Got it" (líneas 544-596).

## 5. Trabajo NUEVO: apagar mic/cámara con permisos ya otorgados

Esto es el gap identificado en [00-contexto-y-decision.md](00-contexto-y-decision.md) — no existe
en `meeting-bot` porque ahí el bot corre sin permisos de dispositivo otorgados.

Con el perfil clonado del usuario, al llegar a la pantalla de preview de Meet (antes de "Ask to
join"), lo esperable es:

- Preview de cámara visible (la cámara está prendida por default si el perfil tiene permiso).
- Dos botones toggle: uno de micrófono, uno de cámara (selectors típicos de Meet:
  `button[aria-label*="microphone" i]`, `button[aria-label*="camera" i]` — **verificar contra el
  Meet real al implementar**, la UI de Meet cambia seguido, tal como ya advierte
  `screenappai/meeting-bot\src\bots\GoogleMeetBot.ts` con sus múltiples
  variantes de selector).

Pasos a implementar, **antes** de clickear "Ask to join":

1. Detectar si el botón "Continue without microphone and camera" aparece (reusar
   `clickContinueWithoutDevicesIfPresent`, líneas 98-112 del archivo de referencia). Si aparece y
   se clickea, mic/cámara ya quedan fuera — no hace falta el paso 2.
2. Si NO aparece (caso esperado con perfil logueado con permisos): buscar los botones toggle de
   mic y cámara, leer su estado (aria-pressed / aria-label indicando "Turn off"/"Turn on") y
   clickearlos si están en estado "encendido", hasta confirmar que ambos quedan apagados.
3. Verificar el estado final antes de seguir (leer el aria-label de nuevo tras el click, no asumir
   que el click funcionó a la primera) y loggear explícitamente "mic: off, cámara: off" antes de
   avanzar — esto es justamente lo que el usuario pidió poder confiar sin tener que mirar.
4. Si después de reintentos no se puede confirmar que mic/cámara están apagados, no continuar el
   join silenciosamente — cortar con un error claro (ver siguiente sección).

## 6. Confiabilidad (prioridad sobre elegancia)

Por pedido explícito: priorizar que Etapa 1 sea confiable (selectors robustos, logs claros, no
crashear silenciosamente) por sobre que sea elegante.

- Logger estructurado (nivel mínimo: timestamp + mensaje + contexto), no `console.log` sueltos sin
  contexto. `screenappai/meeting-bot\src\util\logger.ts` es un buen ejemplo
  de forma (Winston) pero no hace falta copiar toda su config, alcanza con algo simple.
- Cada paso crítico (perfil logueado, pantalla de Meet detectada, mic/cam confirmados apagados,
  "Ask to join" clickeado, admitido en la llamada) debe loggear explícitamente éxito o falla — no
  asumir.
- Si algo falla, el proceso debe terminar con un mensaje claro y un exit code distinto de 0 (para
  poder detectarlo si en el futuro esto se dispara vía Task Scheduler de Windows), no quedar
  colgado ni fallar en silencio.
- Capturar screenshot en disco (no upload, solo local) en los puntos de falla, para poder ver qué
  pasó sin tener que reproducir en vivo — inspirado en `uploadDebugImage` de
  `screenappai/meeting-bot\src\services\bugService.ts`, pero guardando a
  disco local en vez de subir a GCP.

## 7. Qué NO hacer en esta etapa

- No implementar grabación ni upload.
- No implementar scraping de captions, cliente de Claude, ni la tool `leave_call` — ver
  [03-etapa2-alcance.md](03-etapa2-alcance.md) para qué sí dejar preparado sin implementarlo.
- No traer Redis, colas, ni ningún concepto de multi-tenant/`teamId`/`bearerToken`.
- No dejar el bot saliendo solo de la llamada — en Etapa 1 el usuario sale manualmente (Etapa 2 es
  la que automatiza la salida).

## 8. Definición de "hecho" para Etapa 1

- El script, corrido en un horario dentro de la ventana configurada, abre Chrome con el perfil
  clonado, navega al Meet, confirma mic y cámara apagados, clickea "Ask to join" (o "Join now" si
  no hay lobby), y queda conectado en la llamada.
- Si se corre fuera de la ventana horaria, no intenta entrar.
- Si el perfil no está logueado, falla con un mensaje claro en vez de colgarse en la pantalla de
  sign-in.
- Si Meet no admite al bot dentro de un tiempo razonable, falla con un mensaje claro en vez de
  quedar esperando indefinidamente.
- Queda un log legible de cada paso, y capturas en disco de cualquier punto de falla.

## Checklist de implementación

- [x] Setup del proyecto (pnpm, TypeScript, tsx, playwright, dotenv, winston)
- [x] `.env.example` con todos los valores configurables
- [x] `src/config.ts` — carga de `.env` con validación
- [x] `src/logger.ts` — logger estructurado (Winston)
- [x] `src/errors.ts` — clases de error custom
- [x] `src/constants.ts` — textos de UI de Meet
- [x] `src/resilience.ts` — utilidad de reintentos
- [x] `src/browser.ts` — lanzamiento de Chrome con perfil persistente
- [x] `src/meet.ts` — lógica de join completa (mic/cam off, join, lobby, modales)
- [x] `src/scheduler.ts` — espera por ventana horaria
- [x] `src/index.ts` — entry point que orquesta todo
- [x] `README.md` con instrucciones de setup y troubleshooting
- [x] `.gitignore` (node_modules, .env, debug-screenshots, dist)
- [x] TypeScript typecheck pasa limpio
