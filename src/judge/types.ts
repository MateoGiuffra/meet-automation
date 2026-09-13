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
}
