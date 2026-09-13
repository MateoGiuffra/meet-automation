import type { LlmClient } from '../llm/index.js';
import { getLogger } from '../logger.js';
import { JUDGE_SYSTEM_PROMPT, buildJudgeUserPrompt } from './prompt.js';
import type { JudgeContext } from './types.js';
import type { JudgeDecision } from '../monitor/types.js';

const logger = getLogger('judge');

function parseDecision(rawText: string): JudgeDecision {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Respuesta del juez sin JSON: "${rawText.slice(0, 200)}"`);
  }

  const parsed = JSON.parse(match[0]) as Partial<JudgeDecision>;
  if (typeof parsed.leave !== 'boolean') {
    throw new Error(`Respuesta del juez sin campo "leave" booleano: ${match[0]}`);
  }

  return {
    leave: parsed.leave,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '(sin razón provista)',
  };
}

/**
 * Le pregunta al LLM (juez) si hay que salir de la llamada, con contexto
 * agregado. Cada llamada usa una sesión nueva y descartable — el juez no
 * necesita memoria entre invocaciones, recibe todo el contexto relevante
 * en cada prompt.
 */
export async function askJudge(llm: LlmClient, context: JudgeContext): Promise<JudgeDecision> {
  const session = llm.createSession({ purpose: 'class-end-judge', trigger: context.trigger.reason });
  const prompt = `${JUDGE_SYSTEM_PROMPT}\n\n---\n\n${buildJudgeUserPrompt(context)}`;

  logger.info('Consultando al juez LLM', { trigger: context.trigger.reason });
  const result = await llm.sendMessage(prompt, { session });
  const decision = parseDecision(result.text);
  logger.info('Decisión del juez', { decision });
  return decision;
}
