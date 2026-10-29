import { splitDialogue } from '../public/text.js';

export const VOICES = Object.freeze({
  piseth: 'km-KH-PisethNeural',
  sreymom: 'km-KH-SreymomNeural',
  visal: 'km-KH-PisethNeural',
  mina: 'km-KH-SreymomNeural',
});
export const MAX_TEXT_CHARACTERS = 20000;
export const MAX_PARTS = 200;
// Leave room for retries/platform overhead under the Workers free-plan limit.
export const MAX_SYNTHESIS_REQUESTS = 40;
export const MAX_ESCAPED_BYTES = 3500;

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function escapeXml(text) {
  return text.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

// Count the UTF-8 bytes after SSML escaping, without splitting a Unicode
// code point or an XML entity. The service accepts at most 4096 text bytes.
function escapedBytes(char) {
  if (char === '&') return 5;
  if (char === '<' || char === '>') return 4;
  if (char === '"' || char === "'") return 6;
  const code = char.codePointAt(0);
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
}

export function splitText(text, limit = MAX_ESCAPED_BYTES) {
  const chars = Array.from(text);
  const chunks = [];
  let start = 0;
  while (start < chars.length) {
    let end = start;
    let bytes = 0;
    let lastSpace = -1;
    while (end < chars.length && bytes + escapedBytes(chars[end]) <= limit) {
      bytes += escapedBytes(chars[end]);
      if (/\s/u.test(chars[end])) lastSpace = end + 1;
      end++;
    }
    if (end === start) throw new InputError('Text contains a character that is too large.');
    if (end < chars.length && lastSpace > start) end = lastSpace;
    const chunk = chars.slice(start, end).join('').trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

function asNumber(value, defaultValue, label) {
  if (value === undefined) return defaultValue;
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '')) {
    throw new InputError(`${label} must be a number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new InputError(`${label} must be a number.`);
  return number;
}

function cleanText(value) {
  return value.replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF\uFFFE\uFFFF]/gu, ' ')
    .trim();
}

export function prepareSegments(parts, autoSpeed = false) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new InputError('Please provide at least one text part.');
  }
  if (parts.length > MAX_PARTS) throw new InputError(`At most ${MAX_PARTS} voice parts are allowed.`, 413);

  const tasks = [];
  let total = 0;
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part) || typeof part.text !== 'string') {
      throw new InputError('Each part must contain text.');
    }
    total += Array.from(part.text).length;
    if (total > MAX_TEXT_CHARACTERS) {
      throw new InputError(`Text exceeds the ${MAX_TEXT_CHARACTERS}-character limit.`, 413);
    }
    if (!part.text.trim()) continue;
    const voiceName = part.voiceName === undefined ? 'piseth' : part.voiceName;
    if (typeof voiceName !== 'string' || !Object.hasOwn(VOICES, voiceName)) {
      throw new InputError('Unknown voice. Choose Piseth or Sreymom.');
    }
    const speed = asNumber(part.speed, 1, 'Speed');
    const pitch = asNumber(part.pitch, 0, 'Pitch');
    if (part.autoSpeed !== undefined && typeof part.autoSpeed !== 'boolean') {
      throw new InputError('Per-part autoSpeed must be true or false.');
    }
    const partAutoSpeed = part.autoSpeed ?? autoSpeed;
    if (speed < 0.5 || speed > 2) throw new InputError('Speed must be between 0.5 and 2.0.');
    if (!Number.isInteger(pitch) || pitch < -10 || pitch > 10) {
      throw new InputError('Pitch must be a whole number between -10 and 10.');
    }

    for (const dialogue of splitDialogue(part.text)) {
      const text = cleanText(dialogue);
      if (!text) continue;
      const length = Array.from(text).length;
      const finalSpeed = partAutoSpeed && speed === 1 ? (length > 45 ? 1.4 : length > 30 ? 1.2 : 1) : speed;
      const rateValue = Math.round((finalSpeed - 1) * 100);
      const pitchValue = pitch * 20;
      const rate = `${rateValue >= 0 ? '+' : ''}${rateValue}%`;
      const pitchHz = `${pitchValue >= 0 ? '+' : ''}${pitchValue}Hz`;

      for (const piece of splitText(text)) {
        const bytes = Array.from(piece).reduce((sum, char) => sum + escapedBytes(char), 0);
        const previous = tasks[tasks.length - 1];
        if (previous && previous.voice === VOICES[voiceName] && previous.rate === rate &&
            previous.pitch === pitchHz && previous.bytes + 1 + bytes <= MAX_ESCAPED_BYTES) {
          previous.text += `\n${piece}`;
          previous.bytes += 1 + bytes;
        } else {
          tasks.push({ text: piece, voice: VOICES[voiceName], rate, pitch: pitchHz, bytes });
          if (tasks.length > MAX_SYNTHESIS_REQUESTS) {
            throw new InputError(`Too many voice changes or text segments (maximum ${MAX_SYNTHESIS_REQUESTS}).`, 413);
          }
        }
      }
    }
  }
  if (!tasks.length) throw new InputError('No text to synthesize.');
  return tasks;
}
