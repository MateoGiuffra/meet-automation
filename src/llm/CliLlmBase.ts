import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger } from '../logger.js';
import { LlmBinaryNotFoundError, LlmNotInitializedError, LlmProcessError, LlmTimeoutError } from './errors.js';
import { LlmClient } from './LlmClient.js';
import type { SessionManager } from './SessionManager.js';
import type { LLMSession, LLMTurnResult, LlmClientOptions } from './types.js';

export interface CliProviderOptions {
  /** Override del binario a usar (path o nombre, ej. "C:\\...\\claude.exe"). */
  binaryPath?: string;
  /** Timeout por invocación del CLI en ms. Default 120000. */
  timeoutMs?: number;
  /** Variables de entorno extra para el proceso hijo. */
  env?: Record<string, string>;
  /** Modelos de fallback cuando el CLI no puede listarlos. */
  defaultModels?: string[];
}

export interface RunOutcome {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export abstract class CliLlmBase extends LlmClient {
  protected readonly timeoutMs: number;
  protected readonly envOverrides: Record<string, string>;
  protected readonly defaultModels: string[];

  private readonly binaryCandidates: string[];
  private binary?: string;

  protected constructor(
    sessions: SessionManager,
    options: LlmClientOptions & CliProviderOptions,
  ) {
    super(sessions, options);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.envOverrides = options.env ?? {};
    this.defaultModels = options.defaultModels ?? [];
    this.binaryCandidates = this.buildCandidates(options.binaryPath);
  }

  /** Nombre del binario por defecto (ej. "claude", "opencode"). */
  protected abstract get defaultBinaryName(): string;

  /** Construye la lista de args para un turno de mensaje. */
  protected abstract buildSendArgs(input: string, session: LLMSession, model: string): string[];

  /** Construye la lista de args para listar modelos (vacío = no se puede listar). */
  protected abstract buildListModelsArgs(): string[];

  /** Parsea el outcome de un turno a un resultado LLM. */
  protected abstract parseTurnOutput(outcome: RunOutcome): LLMTurnResult;

  async init(): Promise<void> {
    if (this.binary) return;
    for (const candidate of this.binaryCandidates) {
      this.binary = candidate;
      try {
        const outcome = await this.runCli(['--version']);
        if (outcome.exitCode !== 0) {
          this.logger.warn('Binario del LLM respondió con error a --version', {
            provider: this.name,
            binary: candidate,
            exitCode: outcome.exitCode,
          });
          continue;
        }
        this.logger.info('Binario del LLM verificado', { provider: this.name, binary: candidate });
        return;
      } catch (err) {
        this.logger.warn('Falló la verificación del binario del LLM', {
          provider: this.name,
          binary: candidate,
          error: err,
        });
        this.binary = undefined;
      }
    }
    throw new LlmBinaryNotFoundError(this.binaryCandidates);
  }

  async getModels(): Promise<string[]> {
    const args = this.buildListModelsArgs();
    if (args.length === 0) {
      return [...this.defaultModels];
    }
    const outcome = await this.runCli(args);
    if (outcome.timedOut) {
      throw new LlmTimeoutError(this.timeoutMs);
    }
    const parsed = this.parseModelLines(outcome.stdout);
    if (parsed.length > 0) {
      return parsed;
    }
    this.logger.warn('El CLI no devolvió modelos — usando lista default', {
      provider: this.name,
      exitCode: outcome.exitCode,
      stderr: outcome.stderr.slice(0, 500),
    });
    return [...this.defaultModels];
  }

  protected async runCli(args: string[]): Promise<RunOutcome> {
    if (!this.binary) {
      throw new LlmNotInitializedError();
    }
    const logger = getLogger(`llm.${this.name}`);
    logger.debug('Ejecutando CLI', { binary: this.binary, args });

    return new Promise<RunOutcome>((resolve, reject) => {
      const binaryName = this.binary;
      let child: ChildProcess;
      try {
        child = this.spawnProcess(args);
      } catch (err) {
        this.binary = undefined;
        if (isEnoent(err)) {
          reject(new LlmBinaryNotFoundError([binaryName ?? this.defaultBinaryName]));
          return;
        }
        reject(new LlmProcessError(`Error al spawnear el CLI: ${String(err)}`, -1, ''));
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (outcome: RunOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle({ exitCode: -1, timedOut: true, stdout, stderr });
      }, this.timeoutMs);

      const stdoutStream = child.stdout;
      const stderrStream = child.stderr;

      stdoutStream!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      stderrStream!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        if (settled) return;
        if (isEnoent(err)) {
          this.binary = undefined;
          clearTimeout(timer);
          settled = true;
          reject(new LlmBinaryNotFoundError([binaryName ?? this.defaultBinaryName]));
          return;
        }
        clearTimeout(timer);
        settled = true;
        reject(new LlmProcessError(`Error del CLI: ${err.message}`, -1, stderr));
      });
      child.on('close', (code) => {
        settle({ exitCode: code ?? -1, timedOut: false, stdout, stderr });
      });
    });
  }

  protected parseJsonLines(stdout: string): Record<string, unknown>[] {
    const events: Record<string, unknown>[] = [];
    for (const raw of stdout.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Línea no-JSON en stdout: se ignora (ej. prints del CLI).
      }
    }
    return events;
  }

  protected parseModelLines(stdout: string): string[] {
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith('#'));
  }

  protected async doSend(text: string, session: LLMSession, model: string): Promise<LLMTurnResult> {
    const args = this.buildSendArgs(text, session, model);
    getLogger(`llm.${this.name}`).debug('Enviando mensaje LLM', { sessionId: session.id, args });
    const outcome = await this.runCli(args);
    if (outcome.timedOut) {
      throw new LlmTimeoutError(this.timeoutMs);
    }
    return this.parseTurnOutput(outcome);
  }

  private buildCandidates(explicit?: string): string[] {
    if (explicit) {
      return [explicit];
    }
    const base = this.defaultBinaryName;
    if (process.platform === 'win32') {
      return [base, `${base}.cmd`, `${base}.exe`];
    }
    return [base];
  }

  private spawnProcess(args: string[]): ChildProcess {
    const options = {
      env: { ...process.env, ...this.envOverrides },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    };
    const command = this.binary!;
    if (/\.(cmd|bat)$/i.test(command)) {
      return spawn('cmd.exe', ['/d', '/s', '/c', command, ...args], options);
    }
    return spawn(command, args, options);
  }
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}