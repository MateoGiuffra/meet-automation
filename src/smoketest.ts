import { access } from 'fs/promises';
import { config } from './config.js';
import { getLogger } from './logger.js';
import { createLlm } from './llm/index.js';
import { askJudge } from './judge/judge.js';
import type { JudgeContext } from './judge/types.js';

const logger = getLogger('smoketest');

export interface SmokeCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkPathExists(name: string, path: string): Promise<SmokeCheckResult> {
  try {
    await access(path);
    return { name, ok: true, detail: path };
  } catch {
    return { name, ok: false, detail: `No existe: ${path}` };
  }
}

/**
 * Prueba end-to-end real del provider de LLM: init (verifica el binario) +
 * una consulta al juez con un trigger sintético, chequeando que la respuesta
 * parsee igual que en producción (askJudge/parseDecision).
 *
 * Este es el check que hubiera agarrado el bug de "Model not found:
 * anthropic/claude-sonnet-4-5" ANTES de entrar a una clase real — antes,
 * ese error recién salía a la luz cuando disparaba el primer trigger real,
 * en medio de la clase, sin margen para arreglarlo a tiempo.
 */
async function checkLlmEndToEnd(): Promise<SmokeCheckResult> {
  const name = `LLM (${config.llm.provider}, modelo ${config.llm.defaultModel})`;
  try {
    const llm = createLlm({
      provider: config.llm.provider,
      defaultModel: config.llm.defaultModel,
      models: config.llm.models,
      claudeBinary: config.llm.claudeBinary || undefined,
      opencodeBinary: config.llm.opencodeBinary || undefined,
      timeoutMs: config.llm.timeoutMs,
    });
    await llm.init();

    const fakeContext: JudgeContext = {
      trigger: { reason: 'trivial_empty_call', detail: 'smoke-test', timestamp: Date.now() },
      chatLines: [],
      captionLines: [],
      participantsAtJoin: 1,
      participantsMax: 1,
      participantsMin: 1,
      participantsNow: 1,
      professorAbsentForMs: null,
      minutesInCall: 0,
      minutesToScheduledEnd: null,
      averageParticipants: null,
      averageParticipantsSampleCount: 0,
    };

    const decision = await askJudge(llm, fakeContext);
    return {
      name,
      ok: true,
      detail: `Respuesta parseada OK (leave=${decision.leave}, confidence=${decision.confidence})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, ok: false, detail: message };
  }
}

/**
 * Batería liviana de checks (sin abrir browser, sin tocar Meet) para
 * detectar configuración rota ANTES de lanzar la automatización real.
 * Corre siempre como primer paso de `main()` — ver index.ts.
 */
export async function runSmokeTest(): Promise<boolean> {
  logger.info('=== Smoke test: verificando configuración antes de lanzar ===');

  const checks: SmokeCheckResult[] = [
    await checkPathExists('Chrome executable', config.chromePath),
    await checkPathExists('Chrome profile dir', config.chromeUserDataDir),
    await checkLlmEndToEnd(),
  ];

  let allOk = true;
  for (const check of checks) {
    if (check.ok) {
      logger.info(`✅ ${check.name}: ${check.detail}`);
    } else {
      allOk = false;
      logger.error(`❌ ${check.name}: ${check.detail}`);
    }
  }

  if (allOk) {
    logger.info('=== Smoke test OK — lanzando la automatización ===');
  } else {
    logger.error('=== Smoke test FALLÓ — no se lanza la automatización real. Arreglá lo de arriba y reintentá. ===');
  }

  return allOk;
}

// Permite correrlo standalone: `pnpm run smoke-test` (sin browser, sin Meet).
if (process.argv[1] && process.argv[1].endsWith('smoketest.ts')) {
  runSmokeTest()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      logger.error('Smoke test crasheó', { error: err });
      process.exit(1);
    });
}
