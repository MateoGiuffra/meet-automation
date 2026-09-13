import { config } from './config.js';
import { getLogger } from './logger.js';
import { launchBrowser } from './browser.js';
import { joinMeet, leaveMeeting } from './meet.js';
import { waitForWindowStart, minutesUntilScheduledEnd } from './scheduler.js';
import { MeetAutomationError } from './errors.js';
import {
  startCaptionScraping,
  stopCaptionScraper,
  startChatScraping,
  stopChatScraper,
  restartChatScraper,
  getParticipantCount,
  checkProfessorPresence,
} from './scraping/index.js';
import type { CaptionEvent, ChatEvent } from './scraping/index.js';
import { ClassEndMonitor } from './monitor/ClassEndMonitor.js';
import { RollingBuffer } from './monitor/rollingBuffer.js';
import type { TriggerEvent } from './monitor/types.js';
import { SessionRecorder } from './session/recorder.js';
import { createLlm } from './llm/index.js';
import { askJudge } from './judge/judge.js';
import type { JudgeContext } from './judge/types.js';

const logger = getLogger('main');

interface TranscriptLine {
  text: string;
  timestamp: number;
}

async function main(): Promise<void> {
  logger.info('=== meet-automation ===');
  logger.info('Configuración', {
    meetUrl: config.meetUrl,
    window: `${config.windowStartTime} - ${config.windowEndTime}`,
    displayName: config.meetDisplayName,
  });

  await waitForWindowStart();

  const { context, page } = await launchBrowser();

  const timers: NodeJS.Timeout[] = [];
  let exiting = false;

  const cleanup = async () => {
    for (const timer of timers) clearInterval(timer);
    logger.info('Cerrando browser...');
    try {
      await stopCaptionScraper(page);
      await stopChatScraper(page);
    } catch {
      // ignore
    }
    try {
      await context.close();
    } catch {
      // ignore
    }
  };

  process.on('SIGINT', async () => {
    logger.info('SIGINT recibido — cerrando...');
    await cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM recibido — cerrando...');
    await cleanup();
    process.exit(0);
  });

  try {
    await joinMeet(page, context);

    logger.info('Meet joineado. Iniciando scraping...');

    const contextWindowMs = config.monitor.judgeContextWindowMinutes * 60 * 1000;
    const chatTranscript = new RollingBuffer<TranscriptLine>(contextWindowMs);
    const captionTranscript = new RollingBuffer<TranscriptLine>(contextWindowMs);

    const initialCount = (await getParticipantCount(page)) ?? 0;
    const recorder = new SessionRecorder(config.monitor.sessionsDir, config.meetUrl, initialCount);
    const monitor = new ClassEndMonitor({
      participantDropPct: config.monitor.participantDropPct,
      participantDropAbsolute: config.monitor.participantDropAbsolute,
      participantDropWindowMs: config.monitor.participantDropWindowMs,
      professorAbsenceGraceMs: config.monitor.professorAbsenceGraceMs,
    });

    const llm = createLlm({
      provider: config.llm.provider,
      defaultModel: config.llm.defaultModel,
      models: config.llm.models,
      claudeBinary: config.llm.claudeBinary || undefined,
      opencodeBinary: config.llm.opencodeBinary || undefined,
      timeoutMs: config.llm.timeoutMs,
    });
    await llm.init();

    const joinedAt = Date.now();
    let lastJudgeCallAt = 0;
    let lastKnownCount: number | null = initialCount;

    const exitFlow = async (reason: string): Promise<void> => {
      if (exiting) return;
      exiting = true;
      logger.info(`Saliendo de la llamada: ${reason}`);
      for (const timer of timers) clearInterval(timer);
      try {
        await stopCaptionScraper(page);
        await stopChatScraper(page);
      } catch {
        // ignore
      }
      await leaveMeeting(page);
      await recorder.finish(reason, lastKnownCount);
      await context.close();
      process.exit(0);
    };

    const handleTrigger = async (trigger: TriggerEvent): Promise<void> => {
      recorder.recordTrigger(trigger);

      const sinceLastJudge = Date.now() - lastJudgeCallAt;
      if (sinceLastJudge < config.monitor.judgeMinIntervalMs) {
        logger.info('Trigger detectado pero rate-limit del juez activo — se ignora por ahora', {
          reason: trigger.reason,
          waitMoreMs: config.monitor.judgeMinIntervalMs - sinceLastJudge,
        });
        return;
      }
      lastJudgeCallAt = Date.now();

      const stats = monitor.getStats();
      const judgeContext: JudgeContext = {
        trigger,
        chatLines: chatTranscript.all().map((l) => l.text),
        captionLines: captionTranscript.all().map((l) => l.text),
        participantsAtJoin: initialCount,
        participantsMax: stats.max,
        participantsMin: stats.min,
        participantsNow: lastKnownCount,
        professorAbsentForMs: trigger.reason === 'professor_absent' ? Date.now() - trigger.timestamp : null,
        minutesInCall: Math.round((Date.now() - joinedAt) / 60000),
        minutesToScheduledEnd: (() => {
          try {
            return minutesUntilScheduledEnd();
          } catch {
            return null;
          }
        })(),
      };

      const startedAt = Date.now();
      try {
        const decision = await askJudge(llm, judgeContext);
        recorder.recordJudgeInvocation({
          timestamp: startedAt,
          trigger,
          decision,
          durationMs: Date.now() - startedAt,
        });
        if (decision.leave) {
          await exitFlow(`judge: ${decision.reason}`);
        }
      } catch (err) {
        logger.error('Error consultando al juez LLM', { error: err });
        recorder.recordJudgeInvocation({
          timestamp: startedAt,
          trigger,
          decision: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startedAt,
        });
      }
    };

    // ── Captions scraping ─────────────────────────────────────────────
    const captionCallback = (event: CaptionEvent) => {
      logger.info(`[CAPTION] ${event.speaker}: ${event.text}`);
      captionTranscript.push({ text: `${event.speaker}: ${event.text}`, timestamp: event.timestamp });
      recorder.recordCaptionEvent(event.speaker, event.text);
    };
    const captionsStarted = await startCaptionScraping(page, captionCallback);
    logger.info(captionsStarted ? 'Caption scraping activo' : 'Caption scraping no pudo iniciarse');

    // ── Chat scraping ─────────────────────────────────────────────────
    const chatCallback = (event: ChatEvent) => {
      logger.info(`[CHAT] ${event.author}: ${event.text}`);
      chatTranscript.push({ text: `${event.author}: ${event.text}`, timestamp: event.timestamp });
      recorder.recordChatEvent(event.author, event.text);

      const trigger = monitor.recordChatMessage(event.text);
      if (trigger) void handleTrigger(trigger);
    };
    const chatStarted = await startChatScraping(page, chatCallback);
    logger.info(chatStarted ? 'Chat scraping activo' : 'Chat scraping no pudo iniciarse');

    if (!captionsStarted && !chatStarted) {
      logger.warn('Ningún scraper se pudo iniciar — el browser queda abierto para inspección manual');
    }

    // ── Poll de participantes (barato, no invasivo) ─────────────────────
    const participantTimer = setInterval(async () => {
      if (exiting) return;
      const count = await getParticipantCount(page);
      if (count === null) return;
      lastKnownCount = count;

      const stats = monitor.getStats();
      recorder.updateParticipantStats(Math.max(stats.max, count), Math.min(stats.min, count));

      // Caso trivial: solo queda el bot. Sale directo, sin pasar por el juez.
      // Solo si antes vimos más de 1 persona (evita falso positivo justo al joinear).
      if (count <= 1 && stats.max > 1) {
        await exitFlow('Quedan 0 personas además del bot en la llamada');
        return;
      }

      const trigger = monitor.recordParticipantCount(count);
      if (trigger) void handleTrigger(trigger);
    }, config.monitor.participantPollIntervalMs);
    timers.push(participantTimer);

    // ── Chequeo de presencia del profe (invasivo: abre/cierra panel People) ──
    if (config.monitor.professorName.trim()) {
      const professorTimer = setInterval(async () => {
        if (exiting) return;
        const present = await checkProfessorPresence(page, config.monitor.professorName);
        // checkProfessorPresence puede haber reabierto el panel de chat —
        // el observer anterior quedó apuntando a un nodo desmontado.
        if (chatStarted) {
          await restartChatScraper(page, chatCallback);
        }

        const trigger = monitor.recordProfessorPresence(present);
        if (trigger) void handleTrigger(trigger);
      }, config.monitor.professorCheckIntervalMs);
      timers.push(professorTimer);
    } else {
      logger.warn('PROFESSOR_NAME no configurado — no se va a detectar ausencia del profe');
    }

    logger.info('Monitor de fin de clase activo. Presioná Ctrl+C para salir manualmente.');

    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => resolve());
      process.on('SIGTERM', () => resolve());
    });
  } catch (err) {
    if (err instanceof MeetAutomationError) {
      logger.error(err.message, { errorName: err.name });
    } else {
      logger.error('Error inesperado', { error: err });
    }
    await cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Fatal error', { error: err });
  process.exit(1);
});
