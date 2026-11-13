import { InputError, prepareSegments } from './prepare.js';
import { synthesizeEdge, UpstreamError } from './edge-tts.js';

// 1,000,000 Khmer characters are ~3 MB in UTF-8 (plus JSON/multipart
// overhead), so the form limit must comfortably exceed that and the 5 MB
// browser upload limit.
const MAX_FORM_BYTES = 12 * 1024 * 1024;
// A 5,000-cue SRT produces tens of MB of MP3 (48 kbps), so the response is
// streamed in ordered waves instead of buffered in one Blob — the Worker
// memory limit is 128 MB and buffering everything would exceed it.
const MAX_TOTAL_AUDIO_BYTES = 128 * 1024 * 1024;
// Edge TTS calls are independent, so run a few at once: a 5,000-cue SRT
// that used to need thousands of sequential calls now finishes in a
// fraction of the time. Each wave is emitted in task order, so the MP3
// dialogue order never changes.
const SYNTHESIS_CONCURRENCY = 6;
const EMIT_WAVE = 24;

function errorResponse(detail, status, extraHeaders = {}) {
  return Response.json({ detail }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders },
  });
}

async function readLimitedForm(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_FORM_BYTES) throw new InputError('Request is too large.', 413);
  if (!request.body) throw new InputError('Send a multipart form containing data.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORM_BYTES) {
        await reader.cancel();
        throw new InputError('Request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const copy = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('Content-Type') || '' },
      body: new Blob(chunks),
    });
    return await copy.formData();
  } catch {
    throw new InputError('Send a multipart form containing data.');
  }
}

async function processMulti(request, synthesize) {
  // Same-origin browser requests need no CORS. Reject cross-origin form posts;
  // clients without an Origin (such as curl) can still use the public API.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new InputError('Cross-origin requests are not allowed.', 403);
  }
  const form = await readLimitedForm(request);
  const raw = form.get('data');
  if (typeof raw !== 'string' || !raw) throw new InputError('No data provided.');
  if (new TextEncoder().encode(raw).length > MAX_FORM_BYTES) throw new InputError('Request is too large.', 413);
  let parts;
  try { parts = JSON.parse(raw); } catch { throw new InputError('Data must be a valid JSON array.'); }
  const autoSpeed = form.get('autoSpeed') ?? 'false';
  if (autoSpeed !== 'true' && autoSpeed !== 'false') throw new InputError('autoSpeed must be true or false.');
  const tasks = prepareSegments(parts, autoSpeed === 'true');

  // All segments use Edge's 24 kHz / 48 kbps mono MP3 format. Concatenating
  // the MPEG frames in order avoids FFmpeg/transcoding and temporary files.
  // Synthesize one wave (EMIT_WAVE tasks) with bounded parallelism; waves
  // are emitted in task order so the streamed MP3 keeps dialogue order and
  // memory stays bounded no matter how many cues the SRT has.
  let totalBytes = 0;
  const account = chunk => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_TOTAL_AUDIO_BYTES) throw new UpstreamError('Edge TTS audio is too large.');
  };
  async function synthesizeWave(start, end) {
    const wave = new Array(end - start);
    let next = start;
    const workers = Array.from({ length: Math.min(SYNTHESIS_CONCURRENCY, end - start) }, async () => {
      while (next < end) {
        const index = next++;
        const chunk = await synthesize(tasks[index]);
        if (!(chunk instanceof Uint8Array) || !chunk.length) throw new UpstreamError('Edge TTS returned no audio.');
        wave[index - start] = chunk;
      }
    });
    await Promise.all(workers);
    return wave;
  }

  // Synthesize the first wave eagerly so an upstream failure still returns
  // a proper error status before any audio bytes are sent.
  const firstWave = await synthesizeWave(0, Math.min(EMIT_WAVE, tasks.length));
  for (const chunk of firstWave) account(chunk);
  let cursor = firstWave.length;
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of firstWave) controller.enqueue(chunk);
    },
    async pull(controller) {
      if (cursor >= tasks.length) {
        controller.close();
        return;
      }
      const end = Math.min(cursor + EMIT_WAVE, tasks.length);
      const wave = await synthesizeWave(cursor, end);
      cursor = end;
      for (const chunk of wave) {
        account(chunk);
        controller.enqueue(chunk);
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function handleRequest(request, env, options = {}) {
  const path = new URL(request.url).pathname;
  try {
    if (path === '/api/process-multi') {
      if (request.method !== 'POST') return errorResponse('Method not allowed.', 405, { Allow: 'POST' });
      return await processMulti(request, options.synthesize || synthesizeEdge);
    }
    if (path.startsWith('/api/')) return errorResponse('Not found.', 404);
    return env.ASSETS.fetch(request);
  } catch (error) {
    if (error instanceof InputError || error instanceof UpstreamError) {
      return errorResponse(error.message, error.status);
    }
    console.error('Unexpected synthesis error:', error instanceof Error ? error.message : 'unknown error');
    return errorResponse('Unexpected server error. Please try again.', 500);
  }
}

export default {
  fetch(request, env) { return handleRequest(request, env); },
};
