import { config } from './config.js';
import { getLogger } from './logger.js';
import { WindowExpiredError } from './errors.js';

const logger = getLogger('scheduler');

function nowInTimezone(): { hours: number; minutes: number; date: Date } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.tz,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hours = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const minutes = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  return { hours, minutes, date: now };
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Formato de hora inválido: "${timeStr}". Usar HH:mm (ej: 10:00).`);
  }
  return { hours: h, minutes: m };
}

function msUntilTime(targetHours: number, targetMinutes: number): number {
  const { hours: currentH, minutes: currentM, date: now } = nowInTimezone();
  const currentMs = (currentH * 60 + currentM) * 60 * 1000;
  const targetMs = (targetHours * 60 + targetMinutes) * 60 * 1000;
  return targetMs - currentMs;
}

function isWithinWindow(startH: number, startM: number, endH: number, endM: number): boolean {
  const { hours: currentH, minutes: currentM } = nowInTimezone();
  const current = currentH * 60 + currentM;
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  return current >= start && current <= end;
}

function isAfterWindow(endH: number, endM: number): boolean {
  const { hours: currentH, minutes: currentM } = nowInTimezone();
  const current = currentH * 60 + currentM;
  const end = endH * 60 + endM;
  return current > end;
}

/** Minutos que faltan para el horario de fin agendado (negativo si ya pasó). */
export function minutesUntilScheduledEnd(): number {
  const { hours: endH, minutes: endM } = parseTime(config.windowEndTime);
  return Math.round(msUntilTime(endH, endM) / 60000);
}

export async function waitForWindowStart(): Promise<void> {
  const { hours: startH, minutes: startM } = parseTime(config.windowStartTime);
  const { hours: endH, minutes: endM } = parseTime(config.windowEndTime);

  const { hours: currentH, minutes: currentM } = nowInTimezone();
  logger.info('Hora actual', {
    timezone: config.tz,
    time: `${String(currentH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`,
    window: `${config.windowStartTime} - ${config.windowEndTime}`,
  });

  if (isAfterWindow(endH, endM)) {
    logger.error('Ya pasó la ventana horaria', {
      window: `${config.windowStartTime} - ${config.windowEndTime}`,
    });
    throw new WindowExpiredError();
  }

  if (isWithinWindow(startH, startM, endH, endM)) {
    logger.info('Dentro de la ventana horaria — joineando ahora');
    return;
  }

  const waitMs = msUntilTime(startH, startM);
  if (waitMs <= 0) {
    logger.info('Hora de inicio ya pasó pero dentro de ventana — entrando');
    return;
  }

  const waitMinutes = Math.round(waitMs / 60000);
  logger.info(`Esperando ${waitMinutes} minutos hasta la hora de inicio`, {
    timezone: config.tz,
    windowStart: config.windowStartTime,
    windowEnd: config.windowEndTime,
  });

  // Poleo en intervalos cortos (en vez de un único setTimeout largo) para
  // resistir suspensiones de la PC: si el equipo se suspende y se despierta,
  // el timer de un setTimeout largo puede haber quedado desincronizado del
  // reloj real. Chequeando la hora real cada POLL_INTERVAL_MS nos
  // autocorregimos apenas el proceso vuelve a correr.
  const POLL_INTERVAL_MS = 30_000;

  return new Promise((resolve, reject) => {
    const check = () => {
      const { hours: endH2, minutes: endM2 } = parseTime(config.windowEndTime);
      if (isAfterWindow(endH2, endM2)) {
        logger.error('Ya pasó la ventana horaria mientras se esperaba (posible suspensión larga de la PC)', {
          window: `${config.windowStartTime} - ${config.windowEndTime}`,
        });
        reject(new WindowExpiredError());
        return;
      }
      if (isWithinWindow(startH, startM, endH2, endM2)) {
        logger.info('Hora de inicio alcanzada — procediendo a joinear');
        resolve();
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}
