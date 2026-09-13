# Mapa de referencias a `meeting-bot`

Repo base: `screenappai/meeting-bot` (remoto `screenappai/meeting-bot`).
Todos los paths de abajo son absolutos dentro de ese repo. Los números de línea corresponden al
commit `1447ed3` (2026-09, el HEAD de `main` al momento de este análisis) — si pasó tiempo y las
líneas no coinciden, buscar por el nombre de función/símbolo indicado, no confiar ciegamente en el
número.

## 1. Lanzar Chrome con perfil clonado (la pieza central de Etapa 1)

**Archivo**: `screenappai/meeting-bot\src\lib\chromium.ts`

- `createBrowserContext(url, correlationId, botType)` — función completa, líneas 127-315. Es el
  punto de entrada a copiar/adaptar.
- Bloque de perfil persistente (el que importa): líneas 241-272. Usa
  `chromium.launchPersistentContext(config.googleChromeUserDataDir, {...})` con `headless: false`.
  Notar `ignoreDefaultArgs: ['--mute-audio', '--enable-automation']` (línea ~257 vía variable
  `ignoreDefaultArgs` definida en línea 184-186) y `executablePath: config.chromeExecutablePath`.
- Alternativa CDP (conectar a un Chrome ya corriendo en vez de lanzarlo): líneas 212-239. No hace
  falta para la primera versión de Etapa 1, pero es la opción si en el futuro se quiere un Chrome
  persistente "always on" en vez de lanzar/cerrar cada vez.
- Args de browser específicos para Google (`googleBrowserArgs`): líneas 142-149. Ojo:
  `--auto-accept-this-tab-capture` y `--autoplay-policy=no-user-gesture-required` son para el caso
  de grabación vía `getDisplayMedia` — **Etapa 1 no graba, evaluar si conviene sacarlos** (no
  deberían romper nada si quedan, pero no son necesarios).
- `firstRunSuppressionArgs` (líneas 134-140): sí conviene mantenerlos, evitan diálogos de primer
  uso de Chrome que romperían el flujo automatizado.
- Resize de ventana vía CDP (`resizeBrowserWindow`, líneas 20-39): opcional, útil si se corre con
  `headless: false` y se quiere un tamaño de ventana predecible.

**Variables de entorno relevantes** en
`screenappai/meeting-bot\src\config.ts` (líneas 66-74):

```
chromeExecutablePath      ← CHROME_PATH (default '/usr/bin/google-chrome', en Windows hay que
                             apuntarlo al chrome.exe real)
googleChromeCdpUrl        ← GOOGLE_CHROME_CDP_URL (no usar en la v1 de Etapa 1)
googleChromeUserDataDir   ← GOOGLE_CHROME_USER_DATA_DIR (el path al perfil clonado — ESTA es la
                             variable clave)
googleChromeStorageStatePath ← GOOGLE_CHROME_STORAGE_STATE_PATH (no aplica si ya usamos perfil
                             persistente completo)
```

## 2. Lógica de join / selectors de Google Meet

**Archivo**: `screenappai/meeting-bot\src\bots\GoogleMeetBot.ts`

Reutilizar como **referencia de selectors y de la máquina de estados del join**, no copiar la clase
entera (viene acoplada a `MeetBotBase`, `IUploader`, `patchBotStatus`, etc. que no aplican).

- `clickContinueWithoutDevicesIfPresent` (líneas 98-112) y `waitForPreJoinReady` (líneas 114-117):
  manejo del botón "Continue without microphone and camera". **Con perfil clonado con permisos ya
  otorgados, este botón probablemente no aparezca** — ver
  [01-etapa1-implementacion.md](01-etapa1-implementacion.md) para el trabajo nuevo de mic/cam
  toggles que hay que agregar al lado de esto.
- `verifyItIsOnGoogleMeetPage` (líneas 125-151): detecta si cayó en la pantalla de sign-in de
  Google (perfil no logueado) o en una página no soportada. Útil para dar un error claro si el
  perfil clonado no está logueado correctamente.
- Llenado de nombre + click en "Ask to join" con reintentos (líneas 194-282): la función
  `retryActionWithWait` que usa viene de
  `screenappai/meeting-bot\src\util\resilience.ts` — copiar esa utilidad
  también, es genérica y no tiene dependencias de ScreenApp.
- Loop de espera en lobby / detección de admisión, rechazo o timeout (líneas 295-526): usa los
  textos de `screenappai/meeting-bot\src\constants\index.ts`
  (`GOOGLE_LOBBY_MODE_HOST_TEXT`, `GOOGLE_REQUEST_DENIED`, `GOOGLE_REQUEST_TIMEOUT`) — copiar esas
  constantes también.
- Dismissal de modales "Got it" post-join (líneas 544-596) y de notificaciones de
  "Microphone/Camera not found" (líneas 598-640): copiar tal cual, son independientes del resto.
- Nombre de display ajustado: `getGoogleMeetDisplayName` en
  `screenappai/meeting-bot\src\util\googleMeetDisplayName.ts` — opcional,
  solo si se quiere sanitizar el nombre que aparece en Meet.

**NO copiar**: todo lo de grabación (`recordMeetingPage`, líneas 649-1288 — MediaRecorder,
`exposeFunction('screenAppSendData', ...)`, `exposeFunction('screenAppMeetEnd', ...)`,
inactivity/silence detection), ni el manejo de `IUploader`, ni las llamadas a `patchBotStatus`
(`screenappai/meeting-bot\src\services\botService.ts`, líneas 6-41 — nota:
esta función falla en silencio si no hay backend, así que si por error queda alguna referencia no
rompe nada, pero no tiene sentido en este proyecto).

## 3. Errores custom (opcional, si se quiere mismo estilo)

`screenappai/meeting-bot\src\error.ts` define `WaitingAtLobbyRetryError`,
`UnsupportedMeetingError`, `RecordingUploadFailedError`. Para Etapa 1 alcanza con
`WaitingAtLobbyRetryError`/`UnsupportedMeetingError` si se quiere distinguir "no me dejaron entrar"
de "el perfil no está logueado". No hace falta copiar el resto.

## 4. Tipos de referencia

`screenappai/meeting-bot\src\bots\AbstractMeetBot.ts` define `JoinParams` /
`BotLaunchParams` — están acoplados a multi-tenant (`teamId`, `bearerToken`, `uploader`). Para
Etapa 1 conviene un tipo propio y mínimo, ver el instructivo.

## 5. Ejemplo de script standalone ya existente

`screenappai/meeting-bot\src\test\debug.ts` (24 líneas) es el ejemplo más
cercano a "usar `createBrowserContext` sin todo el aparato de jobs/Redis" que ya existe en el repo.
Buen punto de partida como *forma* de script (no de contenido — este solo navega y saca un
screenshot).
