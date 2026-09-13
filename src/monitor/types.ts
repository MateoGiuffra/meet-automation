export interface ParticipantSnapshot {
  count: number;
  timestamp: number;
}

export interface ProfessorPresenceSnapshot {
  present: boolean;
  timestamp: number;
}

export type TriggerReason =
  | 'participant_drop'
  | 'professor_absent'
  | 'chat_farewell_keyword'
  | 'trivial_empty_call';

export interface TriggerEvent {
  reason: TriggerReason;
  detail: string;
  timestamp: number;
}

export interface JudgeDecision {
  leave: boolean;
  confidence: number;
  reason: string;
}

export interface JudgeInvocation {
  timestamp: number;
  trigger: TriggerEvent;
  decision: JudgeDecision | null;
  /** Si el parseo/llamada falló, el motivo. */
  error?: string;
  durationMs: number;
}
