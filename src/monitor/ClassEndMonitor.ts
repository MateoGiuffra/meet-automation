import { getLogger } from '../logger.js';
import { RollingBuffer } from './rollingBuffer.js';
import { FAREWELL_KEYWORDS } from './constants.js';
import type { ParticipantSnapshot, TriggerEvent } from './types.js';

const logger = getLogger('monitor');

export interface ClassEndMonitorOptions {
  participantDropPct: number;
  participantDropAbsolute: number;
  participantDropWindowMs: number;
  professorAbsenceGraceMs: number;
}

/**
 * Acumula señales (participantes, presencia del profe, chat) y decide
 * cuándo hay un "candidato" a fin de clase — no decide salir, solo cuándo
 * vale la pena preguntarle al juez LLM. Los casos triviales (0 personas
 * además del bot) se resuelven aparte, sin pasar por acá.
 */
export class ClassEndMonitor {
  private readonly participantHistory: RollingBuffer<ParticipantSnapshot>;
  private professorAbsentSince: number | null = null;
  private lastProfessorTriggerAt = 0;
  private lastParticipantTriggerAt = 0;

  constructor(private readonly opts: ClassEndMonitorOptions) {
    this.participantHistory = new RollingBuffer(opts.participantDropWindowMs);
  }

  /** Stats acumulados para el recorder de sesión. */
  private maxCount = 0;
  private minCount = Number.POSITIVE_INFINITY;
  private lastCount: number | null = null;

  recordParticipantCount(count: number): TriggerEvent | null {
    const snapshot: ParticipantSnapshot = { count, timestamp: Date.now() };
    this.participantHistory.push(snapshot);
    this.lastCount = count;
    this.maxCount = Math.max(this.maxCount, count);
    this.minCount = Math.min(this.minCount, count);

    const oldest = this.participantHistory.oldest();
    if (!oldest || oldest.count === 0) return null;

    const dropAbs = oldest.count - count;
    const dropPct = (dropAbs / oldest.count) * 100;

    const droppedEnough = dropPct >= this.opts.participantDropPct || dropAbs >= this.opts.participantDropAbsolute;
    if (!droppedEnough) return null;

    // No re-disparar en cada poll mientras la caída siga vigente.
    if (Date.now() - this.lastParticipantTriggerAt < this.opts.participantDropWindowMs) return null;
    this.lastParticipantTriggerAt = Date.now();

    logger.info('Trigger: caída de participantes', { from: oldest.count, to: count, dropPct: Math.round(dropPct) });
    return {
      reason: 'participant_drop',
      detail: `Participantes: ${oldest.count} → ${count} (${Math.round(dropPct)}% en ${Math.round(this.opts.participantDropWindowMs / 1000)}s)`,
      timestamp: Date.now(),
    };
  }

  getStats(): { max: number; min: number; last: number | null } {
    return {
      max: this.maxCount,
      min: this.minCount === Number.POSITIVE_INFINITY ? 0 : this.minCount,
      last: this.lastCount,
    };
  }

  /** `present === null` (no se pudo determinar) no cambia el estado de ausencia. */
  recordProfessorPresence(present: boolean | null): TriggerEvent | null {
    if (present === null) return null;

    if (present) {
      this.professorAbsentSince = null;
      return null;
    }

    if (this.professorAbsentSince === null) {
      this.professorAbsentSince = Date.now();
      return null;
    }

    const absentForMs = Date.now() - this.professorAbsentSince;
    if (absentForMs < this.opts.professorAbsenceGraceMs) return null;

    // No re-disparar en cada chequeo mientras siga ausente.
    if (Date.now() - this.lastProfessorTriggerAt < this.opts.professorAbsenceGraceMs) return null;
    this.lastProfessorTriggerAt = Date.now();

    logger.info('Trigger: profesor ausente', { absentForMs });
    return {
      reason: 'professor_absent',
      detail: `Profesor ausente hace ${Math.round(absentForMs / 1000)}s`,
      timestamp: Date.now(),
    };
  }

  recordChatMessage(text: string): TriggerEvent | null {
    const matched = FAREWELL_KEYWORDS.some((re) => re.test(text));
    if (!matched) return null;

    logger.info('Trigger: keyword de despedida en chat', { text });
    return {
      reason: 'chat_farewell_keyword',
      detail: `Mensaje de chat con tono de despedida: "${text}"`,
      timestamp: Date.now(),
    };
  }
}
