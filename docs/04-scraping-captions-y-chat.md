# Scraping de captions y chat del Meet

Este documento describe cómo funciona la capa de scraping que lee captions (subtítulos)
y mensajes del chat de Google Meet en vivo.

## Arquitectura

```
Browser (Meet DOM)
  │
  │  MutationObserver watches caption/chat container
  │  on new node → extract speaker + text → call bridge function
  │
  ▼
page.exposeFunction (Playwright IPC bridge)
  │
  ▼
Node.js callback → CaptionEvent / ChatEvent
  │
  ▼
Logger (stdout) ← Etapa 2: LLM loop
```

La comunicación browser→Node usa `page.exposeFunction` de Playwright, el mismo patrón
que `meeting-bot` usa para grabación (ver `docs/02-referencias-meeting-bot.md` §5).

## Archivos

| Archivo | Propósito |
|---|---|
| `src/scraping/types.ts` | Tipos: `CaptionEvent`, `ChatEvent`, callbacks |
| `src/scraping/constants.ts` | Selectores DOM, aria-labels de botones |
| `src/scraping/captions.ts` | Toggle de captions + MutationObserver + bridge |
| `src/scraping/chat.ts` | Apertura de panel chat + MutationObserver + bridge |
| `src/scraping/index.ts` | Barrel export |

## Scraping de captions (subtítulos)

### Flujo

1. **`enableCaptions(page)`** — Busca el botón de toggle de captions por aria-label
   (`Turn on captions`, `Untertitel einblenden`, etc.) y lo clickea.
2. Verifica que aparezca la región de captions: `[role="region"][aria-label*="Captions"]`
3. **`setupCaptionScraper(page, callback)`** — Expone la función bridge y configura
   un `MutationObserver` dentro del browser que vigila la región de captions.
4. Cuando aparece un nodo nuevo en la región, el observer extrae:
   - **Speaker**: del elemento `.NWpY1d` (fallback: último speaker conocido)
   - **Text**: contenido del nodo clonado (sin el label de speaker)
5. Deduplicación: mantiene un `Set` de captions ya vistos (por texto exacto).
6. Llama al callback en Node con `{ speaker, text, timestamp }`.

### Selectores

- **Región de captions**: `[role="region"][aria-label*="Captions"]` (selector semántico,
  estable — no depende de clases CSS obfuscatas como `.nMcdL`)
- **Speaker**: `.NWpY1d` (fallback conocido)
- **Texto**: contenido del nodo hijo (se clona y se remueve el speaker)
- **Toggle button**: múltiples aria-labels en EN/DE

### Fallbacks

Si el selector semántico `[role="region"]` no funciona (Google cambió el DOM):
1. Intenta `CAPTION_REGION_SELECTOR_DE` (alemán)
2. Verifica si ya hay una región visible antes de intentar activar
3. Si no puede activar captions, retorna `false` y el scraper no arranca

## Scraping de chat

### Flujo

1. **`openChatPanel(page)`** — Busca el botón "Chat with everyone" / "In-call messages"
   y lo clickea. Fallback: atajo de teclado `Ctrl+Alt+C`.
2. Verifica que el panel esté abierto buscando el textarea de input o el botón de cerrar.
3. **`setupChatScraper(page, callback)`** — Expone bridge + MutationObserver.
4. Primero colecta mensajes existentes como baseline (para no duplicar).
5. Observer vigila el contenedor `[aria-label*="in-call messages" i]` / `[role="complementary"]`.
6. Extrae **author** de `[data-sender-name]` o primera línea del texto.
7. Deduplicación por fingerprint `author|text`.

### Selectores del panel chat

- **Botón de apertura**: aria-labels incluyen "chat with everyone", "in-call messages", "chat"
- **Contenedor del panel**: `[aria-label*="in-call messages" i]`, `[aria-label*="chat" i]`, `[role="complementary"]`
- **Mensajes**: `[role="listitem"]`, `[data-message-id]`, `article`, `li`
- **Input**: `textarea`, `[contenteditable="true"]`, `[role="textbox"]`
- **Atajo de teclado**: `Ctrl+Alt+C` (Windows/ChromeOS), `Ctrl+Cmd+C` (macOS)

## Integración con el main flow

En `src/index.ts`, después de `joinMeet()`:

```typescript
await startCaptionScraping(page, (event) => {
  logger.info(`[CAPTION] ${event.speaker}: ${event.text}`);
});

await startChatScraping(page, (event) => {
  logger.info(`[CHAT] ${event.author}: ${event.text}`);
});
```

Ambos scrapers son independientes — si uno falla, el otro sigue funcionando.

## Limpieza

En SIGINT/SIGTERM:
```typescript
await stopCaptionScraper(page);
await stopChatScraper(page);
await context.close();
```

Esto desconecta los observers y limpia las funciones expuestas del browser.

## Limitaciones conocidas

1. **Selectores frágiles**: Google Meet no tiene API pública para captions. Los
   selectores `.NWpY1d` y las classes de caption items pueden cambiar con actualizaciones
   de UI. Los selectores semánticos (`[role="region"][aria-label]`) son más estables.

2. **Un solo idioma de captions**: Google Meet solo renderiza un idioma de subtítulos a la vez.

3. **Chat solo en vivo**: Los mensajes que estaban en el chat ANTES de unirse al meet
   no se capturan (Meet no los muestra). Solo se capturan mensajes nuevos.

4. **No hay speaker labels estables**: El nombre del speaker en captions depende de un
   selector CSS que puede cambiar. El chat tiene `[data-sender-name]` que es más estable.

## Connectores para Etapa 2

Los callbacks se pueden conectar directamente al LLM:

```typescript
const captionCallback = async (event: CaptionEvent) => {
  await llm.sendMessage(`[CAPTION ${event.speaker}]: ${event.text}`);
};

const chatCallback = async (event: ChatEvent) => {
  await llm.sendMessage(`[CHAT ${event.author}]: ${event.text}`);
};
```

La función `leaveMeeting(page)` (pendiente de extraer de `meet.ts`) se invocaría desde
la tool `leave_call` del LLM cuando detecte que la clase terminó.

## Testing manual

Para probar el scraping sin el LLM:

```bash
pnpm start
```

Observar los logs con `[CAPTION]` y `[CHAT]` en stdout. Los captions requieren que
alguien en el meet hable y que Google Meet tenga subtítulos activados (o que el bot
los active automáticamente vía `enableCaptions`).

## Referencias

- [Google Meet CC to SRT](https://github.com/yunho0130/google-meet-cc-to-srt) — selectores DOM para captions
- [Meet Captions Recorder](http://www.s-anand.net/blog/google-meet-captions-local-transcript-recorder/) — MutationObserver approach
- [Meet Note Taker](https://github.com/AI-Embedded-Open-Source/Meet-Note-Taker) — Chrome extension pattern
- [orbit-agent chat.py](https://github.com/jaibhasin/orbit-agent) — chat panel scraping
- [Playwright Meet gist](https://gist.github.com/Jamie-Chang/567be96880d7a9f995a318d0b0f5a0af) — Python Playwright + expose_function pattern
