import { CliLlmBase, type CliProviderOptions, type RunOutcome } from '../CliLlmBase.js';
import { LlmProcessError } from '../errors.js';
import type { SessionManager } from '../SessionManager.js';
import type { LLMSession, LLMTurnResult, LlmClientOptions } from '../types.js';

const DEFAULT_CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable'];

interface ClaudeResultEvent {
  type?: unknown;
  result?: unknown;
  session_id?: unknown;
  is_error?: unknown;
  subtype?: unknown;
  total_cost_usd?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
  };
}

export class ClaudeCliLlm extends CliLlmBase {
  readonly name = 'claude-cli';

  constructor(sessions: SessionManager, options: LlmClientOptions & CliProviderOptions) {
    super(sessions, { ...options, defaultModels: options.defaultModels ?? DEFAULT_CLAUDE_MODELS });
  }

  protected get defaultBinaryName(): string {
    return 'claude';
  }

  protected buildSendArgs(input: string, session: LLMSession, model: string): string[] {
    const args = ['--print'];
    if (session.providerSessionId) {
      args.push('--resume', session.providerSessionId);
    }
    args.push('--output-format', 'stream-json');
    args.push('--verbose');
    args.push('--model', model);
    args.push(input);
    return args;
  }

  protected buildListModelsArgs(): string[] {
    return [];
  }

  protected parseTurnOutput(outcome: RunOutcome): LLMTurnResult {
    const events = this.parseJsonLines(outcome.stdout) as ClaudeResultEvent[];

    let result: LLMTurnResult | undefined;
    let resultIsError = false;

    for (const event of events) {
      if (event.type !== 'result') continue;
      if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success')) {
        resultIsError = true;
      }
      result = {
        text: typeof event.result === 'string' ? event.result : '',
        providerSessionId: typeof event.session_id === 'string' ? event.session_id : undefined,
        usage: {
          inputTokens: toNumber(event.usage?.input_tokens),
          outputTokens: toNumber(event.usage?.output_tokens),
          cacheReadTokens: toNumber(event.usage?.cache_read_input_tokens),
          cacheCreationTokens: toNumber(event.usage?.cache_creation_input_tokens),
          totalCostUsd: toNumber(event.total_cost_usd),
        },
      };
    }

    if (result) {
      if (resultIsError) {
        throw new LlmProcessError(
          result.text.trim() || `El CLI de Claude respondió con error (exit ${outcome.exitCode}).`,
          outcome.exitCode,
          outcome.stderr,
        );
      }
      return result;
    }

    if (outcome.stdout.trim()) {
      return { text: outcome.stdout.trim() };
    }

    throw new LlmProcessError(
      `El CLI de Claude no devolvió una respuesta parseable (exit ${outcome.exitCode}).`,
      outcome.exitCode,
      outcome.stderr,
    );
  }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}