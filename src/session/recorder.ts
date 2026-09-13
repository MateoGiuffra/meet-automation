import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { getLogger } from '../logger.js';
import type { TriggerEvent, JudgeInvocation } from '../monitor/types.js';

const logger = getLogger('session/recorder');

export interface SessionSummary {
  sessionId: string;
  meetUrl: string;
  joinedAt: string;
  leftAt: string | null;
  exitReason: string | null;
  triggers: TriggerEvent[];
  judgeInvocationCount: number;
  participants: {
    atJoin: number;
    max: number;
    min: number;
    atLeave: number | null;
  };
}

/**
 * Graba un JSON de resumen por sesión (`<sessionId>.json`, reescrito en cada
 * update — es pequeño) y un log crudo append-only de eventos de scraping
 * (`<sessionId>-events.jsonl`, uno por línea, para no reescribir todo en
 * cada mensaje de chat/caption).
 */
export class SessionRecorder {
  private readonly sessionId: string;
  private readonly summaryPath: string;
  private readonly eventsPath: string;
  private summary: SessionSummary;
  private ready: Promise<void>;

  constructor(sessionsDir: string, meetUrl: string, participantsAtJoin: number) {
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.summaryPath = join(sessionsDir, `${this.sessionId}.json`);
    this.eventsPath = join(sessionsDir, `${this.sessionId}-events.jsonl`);
    this.summary = {
      sessionId: this.sessionId,
      meetUrl,
      joinedAt: new Date().toISOString(),
      leftAt: null,
      exitReason: null,
      triggers: [],
      judgeInvocationCount: 0,
      participants: { atJoin: participantsAtJoin, max: participantsAtJoin, min: participantsAtJoin, atLeave: null },
    };
    this.ready = mkdir(sessionsDir, { recursive: true }).then(() => this.persistSummary());
  }

  private async persistSummary(): Promise<void> {
    try {
      await writeFile(this.summaryPath, JSON.stringify(this.summary, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('No se pudo escribir el resumen de sesión', { error: err });
    }
  }

  private async appendEvent(event: Record<string, unknown>): Promise<void> {
    try {
      await this.ready;
      await appendFile(this.eventsPath, `${JSON.stringify({ timestamp: Date.now(), ...event })}\n`, 'utf-8');
    } catch (err) {
      logger.warn('No se pudo escribir evento de sesión', { error: err });
    }
  }

  updateParticipantStats(max: number, min: number): void {
    this.summary.participants.max = max;
    this.summary.participants.min = min;
    void this.persistSummary();
  }

  recordTrigger(trigger: TriggerEvent): void {
    this.summary.triggers.push(trigger);
    void this.persistSummary();
    void this.appendEvent({ kind: 'trigger', ...trigger });
  }

  recordJudgeInvocation(invocation: JudgeInvocation): void {
    this.summary.judgeInvocationCount += 1;
    void this.persistSummary();
    void this.appendEvent({ kind: 'judge_invocation', ...invocation });
  }

  recordChatEvent(author: string, text: string): void {
    void this.appendEvent({ kind: 'chat', author, text });
  }

  recordCaptionEvent(speaker: string, text: string): void {
    void this.appendEvent({ kind: 'caption', speaker, text });
  }

  async finish(exitReason: string, participantsAtLeave: number | null): Promise<void> {
    this.summary.leftAt = new Date().toISOString();
    this.summary.exitReason = exitReason;
    this.summary.participants.atLeave = participantsAtLeave;
    await this.ready;
    await this.persistSummary();
    logger.info('Sesión finalizada y guardada', { summaryPath: this.summaryPath });
  }
}
