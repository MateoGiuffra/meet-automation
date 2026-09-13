export interface CaptionEvent {
  speaker: string;
  text: string;
  timestamp: number;
}

export type CaptionCallback = (event: CaptionEvent) => void | Promise<void>;

export interface ChatEvent {
  author: string;
  text: string;
  timestamp: number;
}

export type ChatCallback = (event: ChatEvent) => void | Promise<void>;
