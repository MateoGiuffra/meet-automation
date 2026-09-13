# Contexto y decisión de arquitectura

## Qué se quiere lograr

**Etapa 1 (prioridad ahora)**: automatización que, en la PC del usuario, usando un CLON del
profile de Chrome del usuario (podría llegar a ser el original en el momento de ejecución), entre
solo a un Google Meet específico entre las 10am y las 12pm, con el micrófono muteado y la cámara
apagada desde el lobby antes de unirse.

**Etapa 2 (después, no implementar todavía — ver [03-etapa2-alcance.md](03-etapa2-alcance.md))**:
mientras el usuario está en la llamada, leer la transcripción/subtítulos en vivo de Meet
(scrapeando el DOM de los captions), mandarle ese texto a Claude vía API en un loop, con una única
tool `leave_call` que Claude invoca cuando detecta frases de despedida/cierre de clase, para que el
bot salga de la llamada justo cuando termina realmente (antes o después del horario agendado).

## Investigación previa

Antes de escribir código se evaluó si convenía partir de un proyecto open source existente
(extensiones de Chrome tipo just-meet/Google-Meet-Auto-Join, o frameworks de meeting-bot en
TypeScript/Playwright) versus armar algo custom desde cero.

**Hallazgo clave**: el repo de trabajo en `screenappai/meeting-bot` **ya es**
`screenappai/meeting-bot` (remoto `https://github.com/screenappai/meeting-bot.git`), activamente
mantenido — con commits del mismo mes en que se hizo esta evaluación (2026-09), 49 PRs mergeados,
soporte multi-plataforma (Google Meet / Microsoft Teams / Zoom) vía Playwright + Redis. No hizo
falta clonar ni evaluar ningún repo externo: la pregunta pasó de "¿qué proyecto uso de base?" a
"¿cuánto de este repo ya resuelve lo que necesito, y cuánto conviene NO arrastrar?".

## Decisión: no forkear `meeting-bot`, sí reutilizar código puntual

`meeting-bot` está diseñado para correr como **servicio de producción multi-tenant**: consume jobs
de una cola Redis, reporta status a un backend SaaS propio (ScreenApp) vía bearer token, sube la
grabación a S3/Azure a través del backend de ScreenApp (no directo), y corre pensado para
Linux/Docker (Xvfb, ffmpeg+PulseAudio para Teams, hooks de ciclo de vida de K8s).

Nada de esa infraestructura aplica a "entrar a una reunión mía, en mi PC, en una ventana horaria,
sin grabar". Forkear el repo entero y tratar de "apagar" todo lo que no se necesita (Redis, upload,
API de ScreenApp) sería más trabajo y más frágil que extraer las ~2 piezas que sí sirven:

1. **`createBrowserContext`** en
   `screenappai/meeting-bot\src\lib\chromium.ts` — ya soporta lanzar Chrome
   con un perfil persistente clonado (`launchPersistentContext` + `GOOGLE_CHROME_USER_DATA_DIR`).
   Es exactamente el mecanismo pedido para Etapa 1.
2. **La lógica de selectors de join** en
   `screenappai/meeting-bot\src\bots\GoogleMeetBot.ts` — manejo de "Ask to
   join", espera en lobby, detección de admisión/rechazo, dismissal de modales "Got it". Es la
   parte más frágil de automatizar contra Meet (la UI cambia seguido) y ya está resuelta con
   reintentos y múltiples idiomas.

Ver el mapeo exacto archivo:línea de todo esto en
[02-referencias-meeting-bot.md](02-referencias-meeting-bot.md).

## Qué falta construir (no existe en `meeting-bot` tal cual)

- **Apagar mic/cámara desde el lobby cuando el perfil YA tiene permisos concedidos.** El flujo
  actual de `GoogleMeetBot` asume un perfil *sin* permisos de cámara/mic para meet.google.com, y
  solo clickea el botón "Continue without microphone and camera" (que aparece cuando Chrome no
  tiene el permiso otorgado). Con un perfil clonado real que el usuario ya usó en Meet antes, ese
  botón probablemente **no aparezca** — en su lugar aparece la pantalla de preview normal con
  preview de cámara y toggles de mic/cámara, que el código actual no busca ni clickea. Esto es
  trabajo nuevo, no reutilización.
- **Scheduling por ventana horaria** (10am-12pm de un día dado, para una URL de Meet específica).
  No existe en `meeting-bot` — ahí el "cuándo" lo decide quien encola el job en Redis.
- **Todo lo que NO se necesita y no hay que arrastrar**: grabación (MediaRecorder + upload a
  S3/Azure vía backend de ScreenApp), notificaciones (webhook/Redis), `patchBotStatus`/`addBotLog`
  contra la API de ScreenApp, JobStore, RedisConsumerService, k8s lifecycle.

## Consecuencia para el nuevo proyecto (`meet-automation`)

Es un proyecto Node/TypeScript + Playwright standalone, sin Redis, sin colas, sin backend propio.
Ver el instructivo completo en [01-etapa1-implementacion.md](01-etapa1-implementacion.md).
