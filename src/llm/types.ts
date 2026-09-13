export interface LLMSession {
  /** Id generado por nosotros, identificador estable de la sesión. */
  id: string;
  /** Id que la sesión tiene dentro del provider (ej. session_id de claude CLI). */
  providerSessionId?: string;
  /** Modelo con el que se creó la sesión. */
  model: string;
  createdAt: Date;
  lastUsedAt: Date;
  /** Metadata libre del llamador (ej. número de clase, materia). */
  metadata: Record<string, unknown>;
}

export interface SendMessageOptions {
  /** Reutilizar una sesión concreta (por objeto o por id). */
  session?: LLMSession;
  sessionId?: string;
  /** Metadata libre para enriquecer la sesión activa. */
  metadata?: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalCostUsd?: number;
}

export interface LLMTurnResult {
  text: string;
  providerSessionId?: string;
  usage?: LLMUsage;
}

export interface LLMResult extends LLMTurnResult {
  /** Nuestro id de sesión. */
  sessionId: string;
  model: string;
  durationMs: number;
}

export interface LlmClientOptions {
  defaultModel: string;
}