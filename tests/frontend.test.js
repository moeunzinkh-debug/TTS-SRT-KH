import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual browser module with a small DOM and mocked fetch.
const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const classes = new Set(id === 'audio-container' ? ['hidden'] : []);
    elements.set(id, {
      value: '', disabled: false, attributes: {},
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      play() { return Promise.reject(new Error('autoplay blocked')); },
    });
  }
  return elements.get(id);
}
globalThis.window = globalThis;
globalThis.document = { getElementById: element, addEventListener() {} };
globalThis.addEventListener = () => {};
const alerts = [];
globalThis.alert = message => alerts.push(message);
const revoked = [];
let urls = 0;
URL.createObjectURL = () => `blob:test-${++urls}`;
URL.revokeObjectURL = url => revoked.push(url);
await import('../public/script.js');

test('Generate sends SRT voice parts and shows playable audio even when autoplay is blocked', async () => {
  element('editor').value = '1\n00:00:01,000 --> 00:00:03,000\nសួស្តី <sreymom pitch="-2" speed="1.2">អ្នក</sreymom> ទាំងអស់';
  let body;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/process-multi');
    body = options.body;
    return new Response(Uint8Array.of(0xff, 0xf3), { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  await window.generateAudio();
  assert.deepEqual(JSON.parse(body.get('data')).map(part => [part.text, part.voiceName, part.speed, part.pitch]), [
    ['សួស្តី', 'piseth', 1, 0], ['អ្នក', 'sreymom', 1.2, -2], ['ទាំងអស់', 'piseth', 1, 0],
  ]);
  assert.equal(body.get('autoSpeed'), 'false');
  assert.equal(element('audio-player').src, 'blob:test-1');
  assert.equal(element('download-link').href, 'blob:test-1');
  assert.equal(element('audio-container').classList.contains('hidden'), false);
  assert.equal(element('loader').classList.contains('hidden'), true);
  assert.equal(element('convert-btn').disabled, false);
  assert.deepEqual(alerts, []);
});

test('API errors are displayed, and a later success revokes the previous URL', async () => {
  globalThis.fetch = async () => Response.json({ detail: 'Edge TTS unavailable' }, { status: 502 });
  await window.generateAudio();
  assert.match(alerts.pop(), /Edge TTS unavailable/);
  assert.equal(element('convert-btn').disabled, false);
  assert.equal(element('loader').classList.contains('hidden'), true);
  globalThis.fetch = async () => new Response(Uint8Array.of(1));
  await window.generateAudio();
  assert.deepEqual(revoked, ['blob:test-1']);
  assert.equal(element('audio-player').src, 'blob:test-2');
});

test('duplicate clicks do not send concurrent requests', async () => {
  let count = 0;
  let finish;
  globalThis.fetch = () => { count++; return new Promise(resolve => { finish = resolve; }); };
  const first = window.generateAudio();
  await window.generateAudio();
  assert.equal(count, 1);
  finish(new Response(Uint8Array.of(1)));
  await first;
  assert.equal(element('convert-btn').disabled, false);
});
