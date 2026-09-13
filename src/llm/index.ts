import { SessionManager } from './SessionManager.js';
import { LlmClient } from './LlmClient.js';
import { LlmProviderNotFoundError } from './errors.js';
import { ClaudeCliLlm } from './providers/ClaudeCliLlm.js';
import { OpenCodeCliLlm } from './providers/OpenCodeCliLlm.js';

export type LlmProviderId = 'claude-cli' | 'opencode-cli';

export interface CreateLlmOptions {
  provider: LlmProviderId;
  defaultModel: string;
  /** Modelos de fallback para getModels(). */
  models?: string[];
  /** Override del binario de claude-cli. */
  claudeBinary?: string;
  /** Override del binario de opencode-cli. */
  opencodeBinary?: string;
  /** Timeout por invocación en ms. */
  timeoutMs?: number;
}

export function createLlm(options: CreateLlmOptions): LlmClient {
  const sessions = new SessionManager();
  switch (options.provider) {
    case 'claude-cli':
      return new ClaudeCliLlm(sessions, {
        defaultModel: options.defaultModel,
        defaultModels: options.models,
        binaryPath: options.claudeBinary,
        timeoutMs: options.timeoutMs,
      });
    case 'opencode-cli':
      return new OpenCodeCliLlm(sessions, {
        defaultModel: options.defaultModel,
        defaultModels: options.models,
        binaryPath: options.opencodeBinary,
        timeoutMs: options.timeoutMs,
      });
    default:
      throw new LlmProviderNotFoundError(String(options.provider));
  }
}

export { LlmClient } from './LlmClient.js';
export { SessionManager } from './SessionManager.js';
export { ClaudeCliLlm } from './providers/ClaudeCliLlm.js';
export { OpenCodeCliLlm } from './providers/OpenCodeCliLlm.js';
export * from './types.js';