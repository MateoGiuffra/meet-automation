import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variable de entorno requerida no definida: ${key}. Copiá .env.example a .env y completala.`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

function optionalListEnv(key: string): string[] | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

const llmProviderRaw = optionalEnv('LLM_PROVIDER', 'claude-cli');
if (llmProviderRaw !== 'claude-cli' && llmProviderRaw !== 'opencode-cli') {
  throw new Error(`LLM_PROVIDER inválido: "${llmProviderRaw}". Usá "claude-cli" u "opencode-cli".`);
}

export const config = {
  meetUrl: requireEnv('MEET_URL'),
  meetDisplayName: optionalEnv('MEET_DISPLAY_NAME', 'Profesor'),

  tz: optionalEnv('TZ', 'America/Argentina/Buenos_Aires'),

  windowStartTime: requireEnv('WINDOW_START_TIME'),
  windowEndTime: requireEnv('WINDOW_END_TIME'),

  chromePath: requireEnv('CHROME_PATH'),
  chromeUserDataDir: requireEnv('CHROME_USER_DATA_DIR'),
  // Subcarpeta de perfil dentro de chromeUserDataDir (ej. "Default", "Profile 1").
  // Ver qué carpeta corresponde a qué cuenta en Local State → profile.info_cache.
  chromeProfileDirectory: optionalEnv('CHROME_PROFILE_DIRECTORY', 'Default'),
  // Puerto de debugging para conectar Playwright vía CDP a un Chrome lanzado
  // por nosotros mismos (no por Playwright) — ver browser.ts.
  chromeDebugPort: optionalNumber('CHROME_DEBUG_PORT', 9333),
  // Fuerza el idioma de Chrome/Meet — evita tener que mantener traducciones
  // de cada texto de la UI para cada idioma posible del perfil.
  chromeLanguage: optionalEnv('CHROME_LANGUAGE', 'en-US'),

  browserWidth: optionalNumber('BROWSER_WIDTH', 1280),
  browserHeight: optionalNumber('BROWSER_HEIGHT', 720),

  lobbyTimeoutMinutes: optionalNumber('LOBBY_TIMEOUT_MINUTES', 5),
  maxJoinAttempts: optionalNumber('MAX_JOIN_ATTEMPTS', 3),
  retryWaitMs: optionalNumber('RETRY_WAIT_MS', 15000),

  debugScreenshotsDir: optionalEnv('DEBUG_SCREENSHOTS_DIR', './debug-screenshots'),

  llm: {
    provider: llmProviderRaw as 'claude-cli' | 'opencode-cli',
    defaultModel: optionalEnv('LLM_DEFAULT_MODEL', 'sonnet'),
    models: optionalListEnv('LLM_MODELS'),
    claudeBinary: optionalEnv('LLM_CLAUDE_BIN', ''),
    opencodeBinary: optionalEnv('LLM_OPENCODE_BIN', ''),
    timeoutMs: optionalNumber('LLM_TIMEOUT_MS', 120000),
  },

  monitor: {
    // Nombre (o substring) del profe para detectar su presencia en el panel People.
    professorName: optionalEnv('PROFESSOR_NAME', ''),

    // Cada cuánto se sondea el conteo de participantes (badge del botón People, no invasivo).
    participantPollIntervalMs: optionalNumber('PARTICIPANT_POLL_INTERVAL_MS', 5000),
    // Caída relativa (%) de participantes dentro de la ventana de abajo para disparar el trigger.
    participantDropPct: optionalNumber('PARTICIPANT_DROP_PCT', 30),
    // Caída absoluta de participantes dentro de la ventana de abajo (lo que dispare primero).
    participantDropAbsolute: optionalNumber('PARTICIPANT_DROP_ABSOLUTE', 4),
    participantDropWindowMs: optionalNumber('PARTICIPANT_DROP_WINDOW_MS', 120000),

    // Cada cuánto se chequea la presencia del profe (abre/cierra panel People — invasivo).
    professorCheckIntervalMs: optionalNumber('PROFESSOR_CHECK_INTERVAL_MS', 15000),
    // Cuánto tiempo de ausencia continua del profe antes de preguntarle al LLM.
    professorAbsenceGraceMs: optionalNumber('PROFESSOR_ABSENCE_GRACE_MS', 20000),

    // Mínimo tiempo entre invocaciones al LLM juez (rate-limit).
    judgeMinIntervalMs: optionalNumber('JUDGE_MIN_INTERVAL_MS', 60000),
    // Minutos de contexto (chat/captions) que se le pasan al juez.
    judgeContextWindowMinutes: optionalNumber('JUDGE_CONTEXT_WINDOW_MINUTES', 10),

    // Directorio donde se guardan los JSON de sesión.
    sessionsDir: optionalEnv('SESSIONS_DIR', './logs/sessions'),

    // Directorio de perfiles por meet (uno por MEET_URL, archivo auto-ajustable
    // con el promedio de participantes observado — ver meetProfile.ts).
    meetProfilesDir: optionalEnv('MEET_PROFILES_DIR', './data/meet-profiles'),
  },
};