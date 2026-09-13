import { CliLlmBase, type CliProviderOptions, type RunOutcome } from '../CliLlmBase.js';
import { LlmProcessError } from '../errors.js';
import type { SessionManager } from '../SessionManager.js';
import type { LLMSession, LLMTurnResult, LlmClientOptions } from '../types.js';

const DEFAULT_OPENCODE_MODELS = ['anthropic/claude-sonnet-4-5'];

export class OpenCodeCliLlm extends CliLlmBase {
  readonly name = 'opencode-cli';

  constructor(sessions: SessionManager, options: LlmClientOptions & CliProviderOptions) {
    super(sessions, { ...options, defaultModels: options.defaultModels ?? DEFAULT_OPENCODE_MODELS });
  }

  protected get defaultBinaryName(): string {
    return 'opencode';
  }

  protected buildSendArgs(input: string, session: LLMSession, model: string): string[] {
    const args = ['run'];
    if (session.providerSessionId) {
      args.push('--session', session.providerSessionId);
    }
    args.push('--format', 'json');
    args.push('--model', model);
    args.push(input);
    return args;
  }

  protected buildListModelsArgs(): string[] {
    return ['models'];
  }

  protected parseTurnOutput(outcome: RunOutcome): LLMTurnResult {
    const events = this.parseJsonLines(outcome.stdout);

    const textById = new Map<string, string>();
    let providerSessionId: string | undefined;
    let idle = false;

    for (const event of events) {
      if (event.type === 'session.id' && typeof event.id === 'string') {
        providerSessionId = event.id;
        continue;
      }
      if (event.type === 'session.status') {
        if (event.status === 'idle') idle = true;
        continue;
      }
      if (event.type === 'message.part.updated' && typeof event.part === 'object' && event.part !== null) {
        const part = event.part as { id?: string; type?: string; text?: string };
        if (part.type === 'text' && typeof part.text === 'string') {
          textById.set(part.id ?? `${textById.size}`, part.text);
        }
      }
    }

    if (textById.size > 0) {
      const text = [...textById.values()].join('\n').trim();
      return { text, providerSessionId };
    }

    if (!idle && outcome.exitCode !== 0) {
      throw new LlmProcessError(
        outcome.stderr.trim() || `El CLI de OpenCode falló (exit ${outcome.exitCode}) sin salida en stderr.`,
        outcome.exitCode,
        outcome.stderr,
      );
    }

    if (outcome.stdout.trim()) {
      return { text: outcome.stdout.trim(), providerSessionId };
    }

    throw new LlmProcessError(
      `El CLI de OpenCode no devolvió una respuesta parseable (exit ${outcome.exitCode}).`,
      outcome.exitCode,
      outcome.stderr,
    );
  }
}