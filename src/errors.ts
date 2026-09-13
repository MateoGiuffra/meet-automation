export class MeetAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetAutomationError';
  }
}

export class ProfileNotLoggedInError extends MeetAutomationError {
  constructor(message = 'El perfil de Chrome no está logueado en Google. Verificá el clon del profile.') {
    super(message);
    this.name = 'ProfileNotLoggedInError';
  }
}

export class LobbyTimeoutError extends MeetAutomationError {
  constructor(message = 'Timeout esperando admisión en el lobby del Meet.') {
    super(message);
    this.name = 'LobbyTimeoutError';
  }
}

export class JoinRequestDeniedError extends MeetAutomationError {
  constructor(message = 'La solicitud de unión fue denegada por alguien en la llamada.') {
    super(message);
    this.name = 'JoinRequestDeniedError';
  }
}

export class WindowExpiredError extends MeetAutomationError {
  constructor(message = 'Ya pasó la ventana horaria configurada. No se intenta entrar.') {
    super(message);
    this.name = 'WindowExpiredError';
  }
}

export class DeviceToggleError extends MeetAutomationError {
  constructor(message = 'No se pudo confirmar que mic/cámara estén apagados.') {
    super(message);
    this.name = 'DeviceToggleError';
  }
}
