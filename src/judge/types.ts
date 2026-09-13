import type { TriggerEvent } from '../monitor/types.js';

export interface JudgeContext {
  trigger: TriggerEvent;
  chatLines: string[];
  captionLines: string[];
  participantsAtJoin: number;
  participantsMax: number;
  participantsMin: number;
  participantsNow: number | null;
  professorAbsentForMs: number | null;
  minutesInCall: number;
  minutesToScheduledEnd: number | null;
  /** Promedio histórico de participantes de ESTE meet (perfil por URL — ver
   * meetProfile.ts). `null` si todavía no hay historial (primera corrida). */
  averageParticipants: number | null;
  averageParticipantsSampleCount: number;
}
