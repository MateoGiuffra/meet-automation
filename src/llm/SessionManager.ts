import { randomUUID } from 'node:crypto';
import { LlmSessionNotFoundError } from './errors.js';
import type { LLMSession } from './types.js';

export class SessionManager {
  private readonly sessions = new Map<string, LLMSession>();
  private activeId?: string;

  create(model: string, metadata: Record<string, unknown> = {}): LLMSession {
    const now = new Date();
    const session: LLMSession = {
      id: randomUUID(),
      model,
      createdAt: now,
      lastUsedAt: now,
      metadata,
    };
    this.sessions.set(session.id, session);
    this.activeId = session.id;
    return session;
  }

  setActive(sessionId: string): LLMSession {
    this.require(sessionId);
    this.activeId = sessionId;
    return this.sessions.get(sessionId)!;
  }

  getActive(): LLMSession | undefined {
    return this.activeId ? this.sessions.get(this.activeId) : undefined;
  }

  requireActive(): LLMSession {
    const session = this.getActive();
    if (!session) {
      throw new LlmSessionNotFoundError('(no hay sesión activa)');
    }
    return session;
  }

  get(sessionId: string): LLMSession | undefined {
    return this.sessions.get(sessionId);
  }

  require(sessionId: string): LLMSession {
    const session = this.get(sessionId);
    if (!session) {
      throw new LlmSessionNotFoundError(sessionId);
    }
    return session;
  }

  list(): LLMSession[] {
    return [...this.sessions.values()];
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.activeId === sessionId) {
      this.activeId = undefined;
    }
  }

  updateProviderSessionId(sessionId: string, providerSessionId: string): void {
    const session = this.require(sessionId);
    session.providerSessionId = providerSessionId;
    session.lastUsedAt = new Date();
  }

  touch(sessionId: string): void {
    this.require(sessionId).lastUsedAt = new Date();
  }
}