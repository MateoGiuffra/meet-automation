import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import { getLogger } from '../logger.js';
import type { TriggerEvent, JudgeInvocation } from '../monitor/types.js';

const logger = getLogger('session/recorder');

/**
 * ISO 8601 con el offset de `config.tz` en vez de "Z" (UTC) — `toISOString()`
 * siempre da UTC sin importar el reloj del sistema, así que un joinedAt a las
 * 15hs ART aparecía como "18:00:47.992Z" en el JSON, confuso para leer a mano.
 * Sigue siendo un timestamp válido/parseable, solo con el offset correcto.
 */
function formatInTz(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const offset = get('timeZoneName').replace('GMT', '') || '+00:00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

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
      joinedAt: formatInTz(new Date(), config.tz),
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
    this.summary.leftAt = formatInTz(new Date(), config.tz);
    this.summary.exitReason = exitReason;
    this.summary.participants.atLeave = participantsAtLeave;
    await this.ready;
    await this.persistSummary();
    logger.info('Sesión finalizada y guardada', { summaryPath: this.summaryPath });
  }
}
