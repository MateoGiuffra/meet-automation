# meet-automation

Bot que se une solo a un Google Meet dentro de una ventana horaria fija, con el micrófono y la
cámara apagados, usando un perfil de Chrome ya logueado. Una vez adentro, escucha el chat y los
subtítulos en vivo, sigue el conteo de participantes y la presencia del profesor, y le pregunta a
un LLM (Claude o OpenCode, corridos como CLI) si la clase realmente terminó antes de salir solo de
la llamada.

**No es un fork de `meeting-bot`** — es un proyecto standalone que reutiliza selectivamente ideas de
`screenappai/meeting-bot` (lanzamiento de Chrome con perfil persistente, manejo de "Ask to join")
sin arrastrar su infraestructura de producción (Redis, colas, backend SaaS, upload a S3).

## Qué hace

- **Join automático** en una ventana horaria (`WINDOW_START_TIME` – `WINDOW_END_TIME`), sin polling:
  un solo `setTimeout` hasta la hora de inicio.
- **Mic y cámara apagados desde el lobby**, antes de pedir unirse.
- **Reintentos y manejo de modales** de la UI de Meet (selectores en varios idiomas, dismissal de
  diálogos "Got it", timeout configurable de lobby).
- **Scraping en vivo** de subtítulos y chat vía `MutationObserver` + `page.exposeFunction`
  (Playwright), sin depender de ninguna API no oficial de Google.
- **Monitor de fin de clase**: combina caída de participantes, ausencia sostenida del profesor y
  keywords de despedida en el chat para decidir cuándo vale la pena preguntarle a un LLM si ya
  terminó.
- **Juez LLM** (`src/judge`): le manda al modelo el contexto agregado (no mensajes sueltos) y espera
  un JSON `{ leave, confidence, reason }`. Soporta Claude CLI y OpenCode CLI como providers
  intercambiables.
- **Registro de sesión**: cada corrida deja un JSON en `logs/sessions/` con triggers, invocaciones al
  juez y stats de participantes, más logs estructurados (Winston) en `logs/`.
- **Screenshots de debug** automáticos si algo falla durante el join.

## Requisitos

- Node.js 18+
- pnpm
- Google Chrome instalado
- Un perfil de Chrome clonado, ya logueado en Google/Meet
- Opcional (para el juez de fin de clase): [Claude CLI](https://github.com/anthropics/claude-code)
  y/o [OpenCode CLI](https://github.com/opencode-ai/opencode) instalados

## Setup

### 1. Instalar dependencias

```bash
pnpm install
npx playwright install chromium
```

### 2. Clonar el perfil de Chrome

Necesitás un clon del profile de Chrome que ya esté logueado en Google (con sesión activa de
Meet). **No uses tu profile real directamente** — usá el clon para que el bot no lo pise.

#### En Windows:

```powershell
mkdir C:\chrome-profile-clone

robocopy "$env:LOCALAPPDATA\Google\Chrome\User Data" "C:\chrome-profile-clone" /E /COPYALL /XD "Cache" "Code Cache" "Service Worker" /XF "*.tmp" /R:1 /W:1
```

> `robocopy` puede tardar varios minutos según el tamaño del profile. Si solo necesitás el profile
> "Default":
>
> ```powershell
> robocopy "$env:LOCALAPPDATA\Google\Chrome\User Data\Default" "C:\chrome-profile-clone\Default" /E /COPYALL /XD "Cache" "Code Cache" /XF "*.tmp" /R:1 /W:1
> ```

Verificá el clon abriendo Chrome con ese `--user-data-dir`: si entrás logueado a meet.google.com
sin que te pida login, funciona.

### 3. Configurar el `.env`

```bash
cp .env.example .env
```

Variables obligatorias:

| Variable | Descripción | Ejemplo |
|---|---|---|
| `MEET_URL` | URL completa del Meet | `https://meet.google.com/abc-defg-hij` |
| `MEET_DISPLAY_NAME` | Nombre que aparece en Meet | `Profesor` |
| `WINDOW_START_TIME` | Hora de inicio de la ventana | `10:00` |
| `WINDOW_END_TIME` | Hora de fin de la ventana | `12:00` |
| `CHROME_PATH` | Path al `chrome.exe` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `CHROME_USER_DATA_DIR` | Path al profile clonado | `C:\chrome-profile-clone` |

Ver `.env.example` para el resto de las opciones (monitor de fin de clase, provider de LLM,
timeouts, reintentos).

### 4. Ejecutar

```bash
pnpm start
```

El script:
1. Si todavía no es hora de inicio, espera.
2. Si ya pasó la hora de fin, sale con error.
3. Dentro de la ventana, abre Chrome, navega al Meet, apaga mic/cámara y clickea "Ask to join".
4. Una vez adentro, arranca el scraping de chat/captions y el monitor de fin de clase.
5. Sale solo cuando detecta que la clase terminó (o con Ctrl+C).

## Estructura

```
src/
├── index.ts            # Entry point — orquesta todo
├── config.ts            # Carga de .env con validación
├── logger.ts             # Logger estructurado (Winston)
├── errors.ts             # Clases de error custom
├── constants.ts          # Textos de UI de Meet (selectores)
├── resilience.ts         # Utilidad de reintentos
├── browser.ts            # Lanzamiento de Chrome con perfil persistente
├── meet.ts               # Lógica de join (mic/cam off, join, lobby, modales)
├── scheduler.ts          # Espera por ventana horaria
├── scraping/             # Captions y chat en vivo (MutationObserver + exposeFunction)
├── monitor/              # ClassEndMonitor — combina señales para disparar el juez
├── judge/                # Prompt + llamada al LLM que decide si salir
├── llm/                  # Clientes de LLM (Claude CLI / OpenCode CLI) intercambiables
└── session/              # Registro de sesión a disco (logs/sessions/*.json)
```

Documentación de decisiones de diseño en [`docs/`](docs/).

## Archivos generados (no versionados)

- `.env` — tu configuración
- `logs/` — logs estructurados y JSON de sesión (`logs/sessions/`)
- `debug-screenshots/` — screenshots automáticos en caso de falla
- `node_modules/`, `dist/`

## Troubleshooting

| Problema | Solución |
|---|---|
| "Variable de entorno requerida no definida" | Copiá `.env.example` a `.env` y completala |
| "El perfil de Chrome no está logueado" | Verificá el clon con `--user-data-dir` manualmente |
| "No se encontró ningún botón de join" | La UI de Meet puede haber cambiado — revisá los screenshots en `debug-screenshots/` |
| Timeout en lobby | El host no admitió a tiempo — subí `LOBBY_TIMEOUT_MINUTES` |
| El juez nunca decide salir | Revisá `logs/sessions/*.json` para ver qué contexto recibió y por qué |

## Alcance actual

- Join en ventana horaria con mic/cámara apagados ✅
- Scraping de captions y chat en vivo ✅
- Monitor de señales de fin de clase (participantes, profesor, keywords) ✅
- Juez LLM que decide cuándo salir realmente ✅
- **NO** graba la llamada, **NO** sube nada a ningún lado, **NO** usa Redis/colas/backend

Ver [docs/00-contexto-y-decision.md](docs/00-contexto-y-decision.md) para el razonamiento completo
detrás de estas decisiones.
