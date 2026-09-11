// @ts-ignore
import messagesLogo from '../../assets/messages.svg';
// @ts-ignore
import antigravityLogo from '../../assets/antigravity.svg';
// @ts-ignore
import chatLogo from '../../assets/chat.svg';
// @ts-ignore
import geminiLogo from '../../assets/gemini.svg';
// @ts-ignore
import responsesLogo from '../../assets/responses.svg';

export const DESKTOP_STATUS_COLUMN_WIDTH = '32px';
export const DESKTOP_DATE_COLUMN_WIDTH = '96px';
export const DESKTOP_API_COLUMN_WIDTH = '58px';
export const DESKTOP_TOKENS_COLUMN_WIDTH = '144px';
export const DESKTOP_COST_COLUMN_WIDTH = '86px';
export const DESKTOP_PERF_COLUMN_WIDTH = '100px';
export const DESKTOP_DELETE_COLUMN_WIDTH = '30px';
export const DESKTOP_TABLE_MIN_WIDTH = '768px';

export const API_LOGOS: Record<string, string> = {
  messages: messagesLogo,
  antigravity: antigravityLogo,
  chat: chatLogo,
  gemini: geminiLogo,
  responses: responsesLogo,
  'openai-responses': responsesLogo,
  // pi-ai/OAuth outgoing API types
  'google-generative-ai': geminiLogo,
  'openai-completions': chatLogo,
  'anthropic-messages': messagesLogo,
};

export const PI_AI_OUTGOING_TYPES: Record<string, true> = {
  'google-generative-ai': true,
  'openai-completions': true,
  'anthropic-messages': true,
  'openai-responses': true,
};
