// The token implementation comes from node-edge-tts 1.2.12 (MIT). Both the
// library and Python edge-tts 7.3.x implement Microsoft's current v2 token.
import {
  CHROMIUM_FULL_VERSION,
  SEC_MS_GEC_VERSION_V2,
  TRUSTED_CLIENT_TOKEN,
  generateSecMsGecToken_V2,
} from 'node-edge-tts/dist/drm.js';
import { escapeXml } from './prepare.js';

const SYNTHESIS_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function connectionId(crypto) {
  return crypto.randomUUID().replace(/-/g, '');
}

function makeMuid(crypto) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function buildSynthesisUrl(id, unixSeconds = Date.now() / 1000) {
  const url = new URL(SYNTHESIS_URL);
  url.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('ConnectionId', id);
  url.searchParams.set('Sec-MS-GEC', generateSecMsGecToken_V2(unixSeconds));
  url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION_V2);
  return url.toString();
}

function fullVoice(shortName) {
  const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(shortName);
  if (!match) throw new UpstreamError('Invalid Edge TTS voice.');
  return `Microsoft Server Speech Text to Speech Voice (${match[1]}-${match[2]}, ${match[3]})`;
}

export function buildMessages(segment, id, date = new Date()) {
  // Edge's SSML request deliberately has an additional trailing Z.
  const timestamp = date.toUTCString().replace(
    /^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/,
    '$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)',
  );
  const config = `X-Timestamp:${timestamp}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${escapeXml(fullVoice(segment.voice))}'><prosody pitch='${segment.pitch}' rate='${segment.rate}' volume='+0%'>` +
    `${escapeXml(segment.text)}</prosody></voice></speak>`;
  return [config, `X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`];
}

function readHeaders(text) {
  const result = {};
  for (const line of text.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) result[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }
  return result;
}

export function parseAudioFrame(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 2) throw new UpstreamError('Edge TTS returned an invalid audio frame.');
  const headerLength = (bytes[0] << 8) | bytes[1];
  if (headerLength + 2 > bytes.length) throw new UpstreamError('Edge TTS returned a truncated audio frame.');
  const headers = readHeaders(new TextDecoder().decode(bytes.subarray(2, 2 + headerLength)));
  const body = bytes.subarray(2 + headerLength);
  if (headers.path !== 'audio') throw new UpstreamError('Edge TTS returned an unexpected frame.');
  if (!body.length && !headers['content-type']) return null; // end-of-audio marker
  if (headers['content-type'] !== 'audio/mpeg' || !body.length) {
    throw new UpstreamError('Edge TTS returned an invalid audio payload.');
  }
  return body;
}

function collectAudio(socket, segment, id, setFailure) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let chunks = [];
    let size = 0;
    let pending = Promise.resolve();

    function finish(error) {
      if (settled) return;
      settled = true;
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      try { socket.close(); } catch { /* already closed */ }
      if (error) {
        chunks = [];
        reject(error);
      } else {
        const audio = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
        resolve(audio);
      }
    }

    setFailure(finish);
    function onMessage(event) {
      // Serialize Blob conversion and turn.end so no audio is lost if frames
      // arrive faster than an asynchronous arrayBuffer() conversion completes.
      pending = pending.then(async () => {
        if (settled) return;
        const data = event.data;
        if (typeof data === 'string') {
          const path = readHeaders(data.split('\r\n\r\n', 1)[0]).path;
          if (path === 'turn.end') {
            if (!size) throw new UpstreamError('Edge TTS returned no audio.');
            finish();
          } else if (!['response', 'turn.start', 'audio.metadata'].includes(path)) {
            throw new UpstreamError('Edge TTS returned an unexpected message.');
          }
          return;
        }
        let binary = data;
        if (typeof Blob !== 'undefined' && data instanceof Blob) binary = await data.arrayBuffer();
        if (!(binary instanceof ArrayBuffer) && !ArrayBuffer.isView(binary)) {
          throw new UpstreamError('Edge TTS returned an invalid audio frame.');
        }
        const view = binary instanceof ArrayBuffer ? new Uint8Array(binary) :
          new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
        const audio = parseAudioFrame(view);
        if (audio) {
          size += audio.length;
          if (size > MAX_AUDIO_BYTES) throw new UpstreamError('Edge TTS audio is too large.');
          chunks.push(audio);
        }
      }).catch(error => finish(error instanceof UpstreamError ? error : new UpstreamError('Could not read Edge TTS audio.')));
    }
    function onClose() {
      pending.then(() => { if (!settled) finish(new UpstreamError('Edge TTS closed before audio was complete.')); });
    }
    function onError() { finish(new UpstreamError('Edge TTS connection failed.')); }

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    try {
      socket.binaryType = 'arraybuffer';
      socket.accept();
      for (const message of buildMessages(segment, id)) socket.send(message);
    } catch {
      finish(new UpstreamError('Could not start Edge TTS synthesis.'));
    }
  });
}

export async function synthesizeEdge(segment, runtime = {}) {
  const runtimeFetch = runtime.fetch || fetch;
  const crypto = runtime.crypto || globalThis.crypto;
  const id = connectionId(crypto);
  const major = CHROMIUM_FULL_VERSION.split('.')[0];
  const abort = new AbortController();
  let failSocket;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
    if (failSocket) failSocket(new UpstreamError('Edge TTS timed out. Please try again.', 504));
  }, runtime.timeoutMs ?? 60000);

  try {
    const response = await runtimeFetch(buildSynthesisUrl(id), {
      headers: {
        Upgrade: 'websocket',
        Origin: ORIGIN,
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Cookie: `muid=${makeMuid(crypto)};`,
      },
      signal: abort.signal,
    });
    if (response.status !== 101 || !response.webSocket) {
      throw new UpstreamError(`Edge TTS connection was rejected (HTTP ${response.status}). Please try again later.`);
    }
    return await collectAudio(response.webSocket, segment, id, callback => { failSocket = callback; });
  } catch (error) {
    if (timedOut) throw new UpstreamError('Edge TTS timed out. Please try again.', 504);
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError('Could not connect to Edge TTS. Please check the network and try again.');
  } finally {
    clearTimeout(timer);
  }
}
