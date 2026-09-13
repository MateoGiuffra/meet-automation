import { createLogger, format, transports, Logger } from 'winston';

const logger = createLogger({
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const serialized = JSON.parse(
        JSON.stringify(meta, (_key, value) =>
          value instanceof Error
            ? { name: value.name, message: value.message, stack: value.stack }
            : value,
        ),
      );
      const metaStr = Object.keys(serialized).length ? ` ${JSON.stringify(serialized)}` : '';
      return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
    }),
  ),
  transports: [new transports.Console()],
});

export function getLogger(context?: string): Logger {
  if (!context) return logger;
  return logger.child({ context });
}
