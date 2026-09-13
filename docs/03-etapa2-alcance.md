# Etapa 2 — alcance y diseño

Este documento existe para que, al implementar Etapa 1, no se tomen decisiones que después
obliguen a reescribir todo.

> **Update (Sep 2026)**: La capa de scraping (captions + chat) ya fue implementada en
> `src/scraping/` como parte de un incremento intermedio. Ver `04-scraping-captions-y-chat.md`
> para detalles. Lo que falta de Etapa 2 es el loop de LLM y la tool `leave_call`.

## Qué es Etapa 2

Mientras el usuario está en la llamada (ya joineada por Etapa 1):

1. Leer la transcripción/subtítulos en vivo de Meet, scrapeando el DOM de los captions (no
   necesariamente audio).
2. Mandarle ese texto a Claude (vía API) en un loop.
3. Claude tiene disponible UNA tool: `leave_call`.
4. Cuando Claude detecta frases de despedida/cierre de clase ("nos vemos profe, buen finde", etc.),
   invoca la tool y el bot sale de la llamada.
5. Objetivo: quedarse conectado hasta el final real de la clase (antes o después del horario
   agendado) sin que el usuario tenga que estar pendiente.

Idea de implementación evaluada (no decidida en detalle todavía): sacar las cookies de sesión
generadas por el browser para usarlas en un cliente WebSocket separado, de forma que Claude solo
reciba texto de transcripción y nunca tenga acceso directo a las cookies/sesión del browser.

## Por qué no se implementa ahora

Por pedido explícito: primero dejar Etapa 1 confiable y probada en un Meet real, antes de sumar la
complejidad de scraping de captions + loop de LLM + tool-calling. Mezclar ambas etapas en la misma
sesión de implementación aumenta el riesgo de que ninguna de las dos quede sólida.

## Qué debe garantizar Etapa 1 para no bloquear Etapa 2

Al implementar Etapa 1 (ver [01-etapa1-implementacion.md](01-etapa1-implementacion.md)), tener en
cuenta:

- **No cerrar el `Page`/`BrowserContext` con un `finally` genérico que asuma que "terminar" siempre
  significa "cerrar todo"**. Etapa 2 va a necesitar mantener la página viva y el contexto
  accesible durante todo el loop de transcripción — el diseño de cierre debe ser explícito
  (un solo punto de salida, ej. una función `leaveMeeting()`), no disperso.
- **Exponer un patrón de comunicación browser→Node reutilizable.** `meeting-bot` ya resuelve esto
  para el caso de grabación con `page.exposeFunction`, ver
  `e:\proyectos\proyectos-2025\js-ts\meeting-bot\src\bots\GoogleMeetBot.ts` líneas 666-671
  (`screenAppSendData`) y 673-684 (`screenAppMeetEnd`). Etapa 2 va a usar el mismo patrón para: (a)
  mandar el texto de captions scrapeado desde `page.evaluate` hacia Node, y (b) exponer una función
  Node-side que el browser pueda invocar cuando el loop de Claude decida salir. Etapa 1 no necesita
  implementar esto, pero la estructura del código (dónde vive el `page`, cómo se organiza el
  módulo de "estar en la llamada") debería poder aceptar un `page.exposeFunction` adicional sin
  refactor grande.
- **La función de "salir de la llamada" debe quedar aislada y reutilizable**, no inline dentro del
  flujo de scheduling. En Etapa 1 el usuario sale manualmente (cerrando el proceso/browser), pero
  conviene tener ya una función `leaveMeeting(page)` clara, aunque en Etapa 1 solo se llame desde
  una señal manual (ej. Ctrl+C / cierre de proceso) — así en Etapa 2 la tool `leave_call` solo tiene
  que invocar esa misma función.
- **El contexto del browser (`BrowserContext`) debe quedar accesible/exportado desde el módulo de
  join**, no encapsulado de forma que haya que reconstruirlo. Etapa 2 va a necesitar
  `context.storageState()` (o las cookies directamente) para el cliente WebSocket separado. No hace
  falta implementar la extracción de cookies en Etapa 1, solo evitar que el `BrowserContext` quede
  inaccesible fuera de la función de join.
- **No asumir un único flujo lineal "join → esperar duración fija → cerrar".** Etapa 1 puede
  implementar el cierre como "esperar a que el usuario corte" sin problema, pero el diseño de
  control de vida de la llamada (dónde se decide cuándo terminar) debería ser un punto de
  extensión, no una constante hardcodeada de duración máxima en medio del código de join.

## Qué NO hace falta que Etapa 1 prediga

No hace falta diseñar todavía: el formato exacto de los mensajes a Claude, el manejo de rate
limits del loop, el mecanismo concreto de WebSocket, ni el esquema de la tool `leave_call`. Eso se
diseña cuando se implemente Etapa 2, con Etapa 1 ya funcionando como base real para probarlo.
