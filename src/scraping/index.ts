export {
  enableCaptions,
  isCaptionsActive,
  setupCaptionScraper,
  stopCaptionScraper,
  startCaptionScraping,
} from './captions.js';

export {
  openChatPanel,
  setupChatScraper,
  stopChatScraper,
  startChatScraping,
  restartChatScraper,
} from './chat.js';

export { getParticipantCount, checkProfessorPresence } from './participants.js';

export type { CaptionEvent, CaptionCallback, ChatEvent, ChatCallback } from './types.js';
