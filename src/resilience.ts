import { Logger } from 'winston';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryActionWithWait<T>(
  actionName: string,
  action: () => Promise<T>,
  logger: Logger,
  attempts: number = 3,
  waitMs: number = 15000,
  onError?: () => Promise<void>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await action();
      return result;
    } catch (err) {
      lastError = err;
      logger.warn(`Retry ${attempt}/${attempts} on "${actionName}"`);
      if (attempt < attempts) {
        await sleep(waitMs);
      }
    }
  }
  if (typeof onError === 'function') {
    await onError();
  }
  logger.error(`Unable to complete "${actionName}" after ${attempts} attempts`);
  throw lastError;
}
