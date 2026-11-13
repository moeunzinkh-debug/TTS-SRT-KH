import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/index.js';
import { UpstreamError } from '../worker/edge-tts.js';

function request(parts, autoSpeed = 'false', headers = {}) {
  const form = new FormData();
  if (parts !== undefined) form.set('data', typeof parts === 'string' ? parts : JSON.stringify(parts));
  form.set('autoSpeed', autoSpeed);
  return new Request('https://studio.example/api/process-multi', { method: 'POST', body: form, headers });
}
const env = { ASSETS: { fetch: async () => new Response('static asset') } };
const one = { text: 'សួស្តី', voiceName: 'piseth', speed: 1, pitch: 0 };

test('POST returns ordered MP3 bytes and passes each voice to the synthesizer', async () => {
  const seen = [];
  const response = await handleRequest(request([one, { ...one, text: 'friend', voiceName: 'sreymom', speed: 1.2, pitch: 2 }]), env, {
    synthesize: async task => { seen.push(task); return Uint8Array.from([0xff, seen.length]); },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [0xff, 1, 0xff, 2]);
  assert.deepEqual(seen.map(task => [task.voice, task.rate, task.pitch]), [
    ['km-KH-PisethNeural', '+0%', '+0Hz'], ['km-KH-SreymomNeural', '+20%', '+40Hz'],
  ]);
});

test('rejects malformed forms, JSON, values, large bodies and cross-origin posts', async () => {
  for (const input of [request(undefined), request('{bad'), request({}), request([{ ...one, speed: 'NaN' }]), request([one], 'maybe')]) {
    const response = await handleRequest(input, env);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).detail, 'string');
  }
  const large = await handleRequest(request([one], 'false', { 'content-length': '13000000' }), env);
  assert.equal(large.status, 413);
  const crossOrigin = await handleRequest(request([one], 'false', { origin: 'https://elsewhere.example' }), env);
  assert.equal(crossOrigin.status, 403);
  const oversizedForm = new FormData();
  oversizedForm.set('data', JSON.stringify([one]));
  oversizedForm.set('unused', 'x'.repeat(13 * 1024 * 1024));
  const noLength = new Request('https://studio.example/api/process-multi', { method: 'POST', body: oversizedForm });
  assert.equal(noLength.headers.has('content-length'), false);
  assert.equal((await handleRequest(noLength, env)).status, 413);
});

test('reports upstream failure instead of returning partial audio', async () => {
  let calls = 0;
  const response = await handleRequest(request([one, { ...one, voiceName: 'sreymom' }]), env, {
    synthesize: async () => {
      if (++calls === 2) throw new UpstreamError('Edge TTS is unavailable.');
      return Uint8Array.of(1, 2);
    },
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { detail: 'Edge TTS is unavailable.' });
});

test('returns a timeout and handles methods and static assets', async () => {
  const timeout = await handleRequest(request([one]), env, { synthesize: async () => { throw new UpstreamError('timed out', 504); } });
  assert.equal(timeout.status, 504);
  const wrongMethod = await handleRequest(new Request('https://studio.example/api/process-multi'), env);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'POST');
  assert.equal((await handleRequest(new Request('https://studio.example/api/missing'), env)).status, 404);
  const staticResponse = await handleRequest(new Request('https://studio.example/'), env);
  assert.equal(await staticResponse.text(), 'static asset');
});

test('accepts the full 1,000,000-character maximum through the API', async () => {
  let calls = 0;
  const response = await handleRequest(request([{ ...one, text: 'x'.repeat(1000000) }]), env, {
    synthesize: async () => { calls++; return Uint8Array.of(1); },
  });
  assert.equal(response.status, 200);
  const buffer = await response.arrayBuffer();
  assert.ok(calls > 1 && calls <= 6000, `expected 2..6000 synthesis calls, got ${calls}`);
  assert.equal(buffer.byteLength, calls);
});

test('a 300-cue SRT with per-cue alternating voices completes in one request', async () => {
  const parts = Array.from({ length: 300 }, (_, index) => ({
    text: 'ខ'.repeat(20), voiceName: index % 2 ? 'sreymom' : 'piseth', speed: 1, pitch: 0,
  }));
  let calls = 0;
  const response = await handleRequest(request(parts), env, {
    synthesize: async () => { calls++; return Uint8Array.of(1); },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 300);
  assert.equal(calls, 300);
});

test('a 5,000-cue SRT with per-cue alternating voices completes in one request', async () => {
  const parts = Array.from({ length: 5000 }, (_, index) => ({
    text: 'ខ'.repeat(20), voiceName: index % 2 ? 'sreymom' : 'piseth', speed: 1, pitch: 0,
  }));
  let calls = 0;
  const response = await handleRequest(request(parts), env, {
    synthesize: async () => { calls++; return Uint8Array.of(1); },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 5000);
  assert.equal(calls, 5000);
});

test('many segments synthesize in parallel but keep dialogue order', async () => {
  const parts = Array.from({ length: 50 }, (_, index) => ({ ...one, text: `line ${index}`, voiceName: index % 2 ? 'sreymom' : 'piseth' }));
  let active = 0;
  let maxActive = 0;
  const response = await handleRequest(request(parts), env, {
    synthesize: async task => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return Uint8Array.from([Number(task.text.split(' ')[1])]);
    },
  });
  assert.equal(response.status, 200);
  assert.ok(maxActive > 1, `expected parallel synthesis, max concurrency was ${maxActive}`);
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from({ length: 50 }, (_, index) => index));
});

test('API passes per-line Auto Speed overrides through to synthesis', async () => {
  const long = 'ខ'.repeat(46);
  const seen = [];
  const response = await handleRequest(request([
    { ...one, text: long, autoSpeed: false },
    { ...one, text: long, pitch: 1 },
  ], 'true'), env, { synthesize: async task => { seen.push(task); return Uint8Array.of(1); } });
  assert.equal(response.status, 200);
  assert.deepEqual(seen.map(({ rate, pitch }) => [rate, pitch]), [['+0%', '+0Hz'], ['+40%', '+20Hz']]);
});
