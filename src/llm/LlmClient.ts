import { getLogger } from '../logger.js';
import { SessionManager } from './SessionManager.js';
import type { LLMResult, LLMSession, LLMTurnResult, LlmClientOptions, SendMessageOptions } from './types.js';

export abstract class LlmClient {
  protected currentModel: string;
  protected readonly logger = getLogger('llm');

  protected constructor(
    protected readonly sessions: SessionManager,
    options: LlmClientOptions,
  ) {
    this.currentModel = options.defaultModel;
  }

  /** Identificador de este provider (para logs). */
  abstract readonly name: string;

  /** Preparar el provider: verificar binario/disponibilidad. Falla claro si no está. */
  abstract init(): Promise<void>;

  /** Lista de modelos disponibles del provider. */
  abstract getModels(): Promise<string[]>;

  /** Cambiar el modelo para próximos mensajes. */
  setModel(model: string): void {
    this.currentModel = model;
    const active = this.sessions.getActive();
    if (active) {
      active.model = model;
    }
  }

  getModel(): string {
    return this.currentModel;
  }

  /** Crear una sesión nueva (la deja activa) y devolverla. */
  createSession(metadata: Record<string, unknown> = {}): LLMSession {
    const session = this.sessions.create(this.currentModel, metadata);
    this.logger.info('Sesión LLM creada', { provider: this.name, sessionId: session.id });
    return session;
  }

  /** Poner una sesión existente como activa para reutilizarla. */
  switchSession(sessionId: string): LLMSession {
    const session = this.sessions.setActive(sessionId);
    this.logger.info('Sesión LLM activada', { provider: this.name, sessionId });
    return session;
  }

  getActiveSession(): LLMSession | undefined {
    return this.sessions.getActive();
  }

  requireActiveSession(): LLMSession {
    return this.sessions.requireActive();
  }

  listSessions(): LLMSession[] {
    return this.sessions.list();
  }

  getSession(sessionId: string): LLMSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Enviar un mensaje. Si no se pasa sesión, usa la activa; si no hay,
   * crea una nueva automáticamente.
   */
  async sendMessage(text: string, options: SendMessageOptions = {}): Promise<LLMResult> {
    const session = this.resolveSession(text, options);

    if (options.metadata) {
      session.metadata = { ...session.metadata, ...options.metadata };
    }

    const startedAt = performance.now();
    const turn = await this.doSend(text, session, this.currentModel);
    const durationMs = Math.round(performance.now() - startedAt);

    if (turn.providerSessionId) {
      this.sessions.updateProviderSessionId(session.id, turn.providerSessionId);
    } else {
      this.sessions.touch(session.id);
    }
    session.model = this.currentModel;

    return {
      text: turn.text,
      providerSessionId: turn.providerSessionId ?? session.providerSessionId,
      usage: turn.usage,
      sessionId: session.id,
      model: session.model,
      durationMs,
    };
  }

  /**
   * Reiniciar la sesión activa (o una dada): crea una sesión nueva vacía
   * y la deja activa. La anterior queda guardada en el registro.
   */
  clear(sessionId?: string): LLMSession {
    const previous = sessionId ? this.sessions.get(sessionId) : this.sessions.getActive();
    const fresh = this.sessions.create(this.currentModel, {
      clearedFrom: previous?.id,
      ...(previous?.metadata ?? {}),
    });
    this.logger.info('Sesión LLM reiniciada', {
      provider: this.name,
      previousSessionId: previous?.id,
      newSessionId: fresh.id,
    });
    return fresh;
  }

  /**
   * Compactar el contexto de la sesión activa (o una dada). Por default es
   * no-op: los CLIs wrapper compactan el contexto automáticamente al crecer.
   */
  compact(sessionId?: string): Promise<void> {
    const session = sessionId ? this.sessions.get(sessionId) : this.sessions.getActive();
    this.logger.debug('compact() no-op: el provider gestiona el contexto automáticamente', {
      provider: this.name,
      sessionId: session?.id,
    });
    return Promise.resolve();
  }

  /** Implementación provider-specific de un turno. */
  protected abstract doSend(text: string, session: LLMSession, model: string): Promise<LLMTurnResult>;

  private resolveSession(text: string, options: SendMessageOptions): LLMSession {
    if (options.session) {
      return options.session;
    }
    if (options.sessionId) {
      return this.sessions.require(options.sessionId);
    }
    const active = this.sessions.getActive();
    if (active) {
      return active;
    }
    this.logger.info('No había sesión activa — creando una para el mensaje', { provider: this.name });
    return this.sessions.create(this.currentModel, { firstMessage: text.slice(0, 80) });
  }
}