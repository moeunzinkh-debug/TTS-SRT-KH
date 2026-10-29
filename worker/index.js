import { InputError, prepareSegments } from './prepare.js';
import { synthesizeEdge, UpstreamError } from './edge-tts.js';

const MAX_FORM_BYTES = 256 * 1024;
const MAX_TOTAL_AUDIO_BYTES = 32 * 1024 * 1024;

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
  const audio = [];
  let audioBytes = 0;
  for (const task of tasks) {
    const chunk = await synthesize(task);
    if (!(chunk instanceof Uint8Array) || !chunk.length) throw new UpstreamError('Edge TTS returned no audio.');
    audioBytes += chunk.length;
    if (audioBytes > MAX_TOTAL_AUDIO_BYTES) throw new UpstreamError('Edge TTS audio is too large.');
    audio.push(chunk);
  }
  return new Response(new Blob(audio, { type: 'audio/mpeg' }), {
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
