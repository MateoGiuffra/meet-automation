import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { getLogger } from './logger.js';

const logger = getLogger('meetProfile');

export interface MeetProfile {
  meetUrl: string;
  /** Copiados de la config al crear el perfil — de referencia, no se auto-ajustan. */
  windowStartTime: string;
  windowEndTime: string;
  /** Promedio de `participantsMax` observado a lo largo de las sesiones — se
   * recalcula solo al final de cada sesión (ver recordParticipantSample). */
  averageParticipants: number;
  /** Cuántas sesiones aportaron al promedio — crece con cada `recordParticipantSample`. */
  sampleCount: number;
  updatedAt: string;
}

function profilePathFor(meetUrl: string, profilesDir: string): string {
  const hash = createHash('sha256').update(meetUrl).digest('hex').slice(0, 16);
  return join(profilesDir, `${hash}.json`);
}

/**
 * Carga el perfil de este meet (uno por MEET_URL, no global) o crea uno
 * nuevo con `averageParticipants` en 0 si es la primera vez que se corre
 * esta URL. `windowStartTime`/`windowEndTime` quedan grabados de referencia
 * en la primera corrida — no se pisan en corridas siguientes aunque cambie
 * el .env, para no perder el historial de qué horario tenía la clase cuando
 * se acumuló el promedio.
 */
export async function loadMeetProfile(
  meetUrl: string,
  profilesDir: string,
  defaults: { windowStartTime: string; windowEndTime: string },
): Promise<MeetProfile> {
  const path = profilePathFor(meetUrl, profilesDir);
  try {
    const raw = await readFile(path, 'utf-8');
    const profile = JSON.parse(raw) as MeetProfile;
    logger.info('Perfil de meet cargado', {
      path,
      averageParticipants: profile.averageParticipants,
      sampleCount: profile.sampleCount,
    });
    return profile;
  } catch {
    const profile: MeetProfile = {
      meetUrl,
      windowStartTime: defaults.windowStartTime,
      windowEndTime: defaults.windowEndTime,
      averageParticipants: 0,
      sampleCount: 0,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(profilesDir, { recursive: true });
    await writeFile(path, JSON.stringify(profile, null, 2), 'utf-8');
    logger.info('Perfil de meet nuevo creado (sin historial todavía)', { path });
    return profile;
  }
}

/**
 * Actualiza el promedio de participantes con una nueva muestra (el
 * `participantsMax` de la sesión que terminó) usando un promedio corrido, y
 * persiste. Llamar una vez por sesión, al salir de la llamada.
 */
export async function recordParticipantSample(
  profile: MeetProfile,
  profilesDir: string,
  observedMax: number,
): Promise<MeetProfile> {
  const newSampleCount = profile.sampleCount + 1;
  const newAverage =
    (profile.averageParticipants * profile.sampleCount + observedMax) / newSampleCount;

  const updated: MeetProfile = {
    ...profile,
    averageParticipants: Math.round(newAverage * 10) / 10,
    sampleCount: newSampleCount,
    updatedAt: new Date().toISOString(),
  };

  const path = profilePathFor(profile.meetUrl, profilesDir);
  try {
    await writeFile(path, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('No se pudo guardar el perfil de meet actualizado', { error: err });
  }

  return updated;
}
