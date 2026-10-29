import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecMsGecToken_V2 } from 'node-edge-tts/dist/drm.js';
import { buildMessages, buildSynthesisUrl, parseAudioFrame, synthesizeEdge } from '../worker/edge-tts.js';

const segment = { text: "សួស្តី & <world> 'test'", voice: 'km-KH-SreymomNeural', rate: '+20%', pitch: '-40Hz' };
function frame(payload, headers = 'Path:audio\r\nContent-Type:audio/mpeg\r\n') {
  const head = new TextEncoder().encode(headers);
  const result = new Uint8Array(2 + head.length + payload.length);
  result[0] = head.length >> 8;
  result[1] = head.length & 255;
  result.set(head, 2);
  result.set(payload, 2 + head.length);
  return result;
}
class FakeSocket extends EventTarget {
  constructor(afterSend = () => {}) { super(); this.sent = []; this.afterSend = afterSend; this.closed = false; }
  accept() { this.accepted = true; }
  send(message) { this.sent.push(message); if (this.sent.length === 2) queueMicrotask(() => this.afterSend(this)); }
  close() { this.closed = true; }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

test('Sec-MS-GEC v2 matches reference tokens and handshake URL', () => {
  assert.equal(generateSecMsGecToken_V2(0), '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6');
  assert.equal(generateSecMsGecToken_V2(1700000000), '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2');
  assert.equal(generateSecMsGecToken_V2(1792134000), 'CF0B4395B2CD4BA5-EC6B89FFC22DF1DBD6A58EF3BC4A5F778F76C002BD63C080F0A4104A5FAEC52B');
  const url = new URL(buildSynthesisUrl('abc', 1700000000));
  assert.equal(url.searchParams.get('Sec-MS-GEC-Version'), '2-143.0.3650.75');
  assert.equal(url.searchParams.get('Sec-MS-GEC'), generateSecMsGecToken_V2(1700000000));
});

test('SSML escapes text, uses the selected voice and preserves prosody', () => {
  const [config, ssml] = buildMessages(segment, 'abc', new Date('2026-10-29T12:00:00Z'));
  assert.match(config, /audio-24khz-48kbitrate-mono-mp3/);
  assert.match(ssml, /Microsoft Server Speech Text to Speech Voice \(km-KH, SreymomNeural\)/);
  assert.match(ssml, /pitch='-40Hz' rate='\+20%'/);
  assert.match(ssml, /សួស្តី &amp; &lt;world&gt; &apos;test&apos;/);
  assert.match(ssml, /Thu Oct 29 2026 12:00:00 GMT\+0000 \(Coordinated Universal Time\)Z/);
});

test('parses binary audio and rejects malformed frames', () => {
  assert.deepEqual(Array.from(parseAudioFrame(frame(Uint8Array.of(1, 2)))), [1, 2]);
  assert.equal(parseAudioFrame(frame(new Uint8Array(), 'Path:audio\r\n')), null);
  assert.throws(() => parseAudioFrame(Uint8Array.of(0)));
  assert.throws(() => parseAudioFrame(Uint8Array.of(0, 10, 0)));
  assert.throws(() => parseAudioFrame(frame(Uint8Array.of(1), 'Path:metadata\r\n')));
  assert.throws(() => parseAudioFrame(frame(Uint8Array.of(1), 'Path:audio\r\n')));
});

test('Worker WebSocket handshake and ordered Blob/audio frames', async () => {
  const socket = new FakeSocket(ws => {
    ws.message('Path:turn.start\r\n\r\n');
    ws.message(new Blob([frame(Uint8Array.of(0xff, 0xf3))]));
    ws.message(frame(Uint8Array.of(1, 2)).buffer);
    ws.message('Path:turn.end\r\n\r\n');
  });
  let handshake;
  const audio = await synthesizeEdge(segment, {
    fetch: async (url, init) => { handshake = { url, init }; return { status: 101, webSocket: socket }; },
    timeoutMs: 1000,
  });
  assert.deepEqual(Array.from(audio), [0xff, 0xf3, 1, 2]);
  assert.equal(socket.accepted, true);
  assert.equal(socket.closed, true);
  assert.equal(handshake.init.headers.Upgrade, 'websocket');
  assert.equal(handshake.init.headers.Origin, 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
  assert.match(handshake.init.headers['User-Agent'], /Edg\/143/);
  assert.match(handshake.init.headers.Cookie, /^muid=[A-F0-9]{32};$/);
  assert.match(new URL(handshake.url).searchParams.get('Sec-MS-GEC'), /^[A-F0-9]{16}-[A-F0-9]{64}$/);
  assert.match(socket.sent[1], /SreymomNeural/);
});

test('fails on a rejected handshake, no audio or premature close', async () => {
  await assert.rejects(synthesizeEdge(segment, { fetch: async () => ({ status: 403 }), timeoutMs: 1000 }), /HTTP 403/);
  const empty = new FakeSocket(ws => ws.message('Path:turn.end\r\n\r\n'));
  await assert.rejects(synthesizeEdge(segment, { fetch: async () => ({ status: 101, webSocket: empty }), timeoutMs: 1000 }), /no audio/);
  const closed = new FakeSocket(ws => {
    ws.message(frame(Uint8Array.of(1)).buffer);
    ws.dispatchEvent(new Event('close'));
  });
  await assert.rejects(synthesizeEdge(segment, { fetch: async () => ({ status: 101, webSocket: closed }), timeoutMs: 1000 }), /before audio was complete/);
});

test('times out and closes stalled sockets', async () => {
  const socket = new FakeSocket();
  await assert.rejects(synthesizeEdge(segment, { fetch: async () => ({ status: 101, webSocket: socket }), timeoutMs: 15 }), error => error.status === 504);
  assert.equal(socket.closed, true);
  await assert.rejects(synthesizeEdge(segment, {
    fetch: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    timeoutMs: 15,
  }), error => error.status === 504);
});
