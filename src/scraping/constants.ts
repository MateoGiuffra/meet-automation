// ── Caption region (semantic selector — stable across DOM rewrites) ──────
export const CAPTION_REGION_SELECTOR = '[role="region"][aria-label*="Captions"]';
export const CAPTION_REGION_SELECTOR_DE = '[role="region"][aria-label*="Untertitel"]';
export const CAPTION_REGION_SELECTOR_ES = '[role="region"][aria-label*="Subtítulos" i]';

// ── Caption item selectors (inside the region) ──────────────────────────
// Speaker name element inside each caption line
export const CAPTION_SPEAKER_SELECTOR = '.NWpY1d';
// Caption text element inside each caption line
export const CAPTION_TEXT_SELECTOR = '.ygicle';
// Fallback: any child div that isn't the speaker
export const CAPTION_ITEM_SELECTOR = '.nMcdL';

// ── Toggle button to enable captions ────────────────────────────────────
// aria-labels for the CC button in different languages
export const CAPTION_TOGGLE_LABELS = [
  'Turn on captions',
  'Subtitles',
  'Untertitel einblenden',
  'Captions',
  'Turn off captions',
  'Activar subtítulos',
  'Desactivar subtítulos',
];

// aria-label for the "leave call" button (used to detect we're still in the call)
export const LEAVE_CALL_SELECTOR = 'button[aria-label="Leave call"], button[aria-label="Anruf verlassen"], button[aria-label="Salir de la llamada"]';

// ── People panel ─────────────────────────────────────────────────────────
// La versión actual de Meet no pone el conteo de participantes en un aria-label
// de <button> (ej. "People (12)") — es un <div role="button"> SIN aria-label,
// con el label y el número pegados en el textContent (ej. "Personas2"). Por
// eso la detección es por prefijo de texto, no por atributo — ver
// getParticipantCount en participants.ts.
export const PEOPLE_BUTTON_TEXT_PREFIXES = ['People', 'Personas', 'Personen'];
// Selector de respaldo por si alguna variante de Meet sí expone aria-label.
export const PEOPLE_BUTTON_SELECTOR = 'button[aria-label^="People" i], button[aria-label^="Personen" i]';

// Opening the People panel (for professor-presence checks) uses the same
// button. El panel en sí no tiene aria-label ni role="complementary" en la
// versión actual de Meet — el ancla confiable es el buscador de adentro
// ("Buscar a gente" / "Search for people"), que solo existe cuando el panel
// de Personas está abierto (a diferencia del panel de Chat, que no tiene
// buscador).
export const PEOPLE_PANEL_SELECTOR = 'input[aria-label*="Buscar a gente" i], input[placeholder*="Buscar a gente" i], input[aria-label*="Search for people" i], input[placeholder*="Search for people" i]';
export const PEOPLE_LIST_ITEM_SELECTOR = '[role="listitem"]';
export const PEOPLE_CLOSE_BUTTON_SELECTOR = 'button[aria-label*="Close" i][aria-label*="people" i], button[aria-label*="Schließen" i]';
