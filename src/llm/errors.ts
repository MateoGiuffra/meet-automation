import { MeetAutomationError } from '../errors.js';

export class LlmError extends MeetAutomationError {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export class LlmNotInitializedError extends LlmError {
  constructor(message = 'LlmClient no inicializado. Llamar a init() antes de usar el cliente.') {
    super(message);
    this.name = 'LlmNotInitializedError';
  }
}

export class LlmBinaryNotFoundError extends LlmError {
  constructor(binaryNames: string[]) {
    super(
      `No se encontró el binario del LLM. Probados: ${binaryNames.join(', ')}. Verificá que el CLI esté instalado o seteá la variable de entorno correspondiente.`,
    );
    this.name = 'LlmBinaryNotFoundError';
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(timeoutMs: number) {
    super(`El CLI del LLM no respondió dentro de ${timeoutMs}ms.`);
    this.name = 'LlmTimeoutError';
  }
}

export class LlmProcessError extends LlmError {
  readonly exitCode: number;
  readonly stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = 'LlmProcessError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class LlmSessionNotFoundError extends LlmError {
  constructor(sessionId: string) {
    super(`No existe la sesión LLM "${sessionId}".`);
    this.name = 'LlmSessionNotFoundError';
  }
}

export class LlmProviderNotFoundError extends LlmError {
  constructor(provider: string) {
    super(`Provider de LLM desconocido: "${provider}". Usá "claude-cli" u "opencode-cli".`);
    this.name = 'LlmProviderNotFoundError';
  }
}