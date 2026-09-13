import type { JudgeContext } from './types.js';

export const JUDGE_SYSTEM_PROMPT = `Sos un juez que decide si un bot debe abandonar una videollamada de Google Meet
porque la clase terminó.

Recibís señales agregadas (no un mensaje suelto): conteo de participantes en el tiempo,
tiempo de ausencia del profesor, y líneas recientes de chat/subtítulos. Tu trabajo es
distinguir DOS casos que se parecen pero son distintos:

1. DESPEDIDA INDIVIDUAL (no salir): una o dos personas se bajan por motivos propios
   ("yo me tengo que ir, gracias profe, nos vemos") mientras la clase sigue. Esto es
   normal en cualquier clase larga y NO es señal de que la clase terminó.

2. FIN DE CLASE REAL (salir): caída colectiva y sostenida de participantes, el profesor
   ausente por un tiempo relevante SIN que la clase parezca seguir sin él, o múltiples
   personas despidiéndose en un lapso corto cerca de terminar la sesión.

Tené en cuenta:
- El profesor puede haberse cortado por wifi/luz y volver en minutos — su sola ausencia
  NO es prueba de que la clase terminó, sobre todo si todavía hay bastante gente conectada
  y no estamos cerca del horario de fin agendado.
- Si estamos cerca o pasado el horario de fin agendado, la barra para decidir "salir" baja.
- Si el conteo de participantes cayó fuerte y de forma sostenida (no solo 1-2 personas),
  es una señal fuerte de que la clase terminó.
- Si te paso el promedio histórico de participantes de esta clase (de sesiones anteriores),
  usalo para calibrar qué tan fuerte es una caída: perder 3 personas en una clase que
  normalmente tiene 4 es clase terminada; perder 3 en una que normalmente tiene 25 no.
  Nunca es la ÚNICA razón para decidir, pero ayuda a interpretar el resto de las señales.

Respondé EXCLUSIVAMENTE con un JSON de una línea, sin texto adicional, con este formato exacto:
{"leave": boolean, "confidence": number entre 0 y 1, "reason": "explicación breve en español"}`;

export function buildJudgeUserPrompt(ctx: JudgeContext): string {
  const lines: string[] = [];

  lines.push(`Trigger que disparó esta consulta: ${ctx.trigger.reason} — ${ctx.trigger.detail}`);
  lines.push('');
  lines.push(`Minutos en la llamada: ${ctx.minutesInCall}`);
  lines.push(
    ctx.minutesToScheduledEnd !== null
      ? `Minutos para el horario de fin agendado: ${ctx.minutesToScheduledEnd} (negativo = ya pasó)`
      : 'Horario de fin agendado: sin dato',
  );
  lines.push('');
  lines.push(`Participantes al entrar: ${ctx.participantsAtJoin}`);
  lines.push(`Participantes máximo visto: ${ctx.participantsMax}`);
  lines.push(`Participantes mínimo visto: ${ctx.participantsMin}`);
  lines.push(`Participantes ahora: ${ctx.participantsNow ?? 'desconocido'}`);
  lines.push(
    ctx.averageParticipants !== null
      ? `Promedio histórico de esta clase: ${ctx.averageParticipants} (de ${ctx.averageParticipantsSampleCount} sesión/es anteriores)`
      : 'Promedio histórico de esta clase: sin dato (primera vez que se corre este meet)',
  );
  lines.push(
    ctx.professorAbsentForMs !== null
      ? `Profesor ausente hace: ${Math.round(ctx.professorAbsentForMs / 1000)}s`
      : 'Profesor: presente o sin dato de ausencia',
  );
  lines.push('');
  lines.push('Chat reciente:');
  lines.push(ctx.chatLines.length ? ctx.chatLines.join('\n') : '(sin mensajes recientes)');
  lines.push('');
  lines.push('Subtítulos recientes:');
  lines.push(ctx.captionLines.length ? ctx.captionLines.join('\n') : '(sin captions recientes / no disponibles)');

  return lines.join('\n');
}
