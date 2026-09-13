// ── Caption region (semantic selector — stable across DOM rewrites) ──────
export const CAPTION_REGION_SELECTOR = '[role="region"][aria-label*="Captions"]';
export const CAPTION_REGION_SELECTOR_DE = '[role="region"][aria-label*="Untertitel"]';

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
];

// aria-label for the "leave call" button (used to detect we're still in the call)
export const LEAVE_CALL_SELECTOR = 'button[aria-label="Leave call"], button[aria-label="Anruf verlassen"]';

// ── People panel ─────────────────────────────────────────────────────────
// The "People" button shows a live participant count in its aria-label
// (e.g. "People (12)") WITHOUT needing to open the panel — cheap to poll.
export const PEOPLE_BUTTON_SELECTOR = 'button[aria-label^="People" i], button[aria-label^="Personen" i]';

// Opening the People panel (for professor-presence checks) uses the same
// button. The panel container + participant list item selectors below.
export const PEOPLE_PANEL_SELECTOR = '[aria-label*="Participants" i], [role="complementary"]';
export const PEOPLE_LIST_ITEM_SELECTOR = '[role="listitem"]';
export const PEOPLE_CLOSE_BUTTON_SELECTOR = 'button[aria-label*="Close" i][aria-label*="people" i], button[aria-label*="Schließen" i]';
