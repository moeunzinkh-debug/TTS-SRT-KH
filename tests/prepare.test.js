import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, InputError, MAX_ESCAPED_BYTES, prepareSegments, splitText } from '../worker/prepare.js';

const part = (text, extra = {}) => ({ text, voiceName: 'piseth', speed: 1, pitch: 0, ...extra });

test('prepares SRT, strips formatting and batches adjacent identical voices', () => {
  const tasks = prepareSegments([part('1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>សួស្តី</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nពិភពលោក')]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, 'សួស្តី\nពិភពលោក');
  assert.equal(tasks[0].voice, 'km-KH-PisethNeural');
  assert.equal(tasks[0].rate, '+0%');
  assert.equal(tasks[0].pitch, '+0Hz');
});

test('manual speed, pitch, aliases and auto speed are respected', () => {
  const tasks = prepareSegments([
    part('ខ'.repeat(31), { voiceName: 'mina' }),
    part('ខ'.repeat(46), { voiceName: 'visal' }),
    part('manual', { voiceName: 'sreymom', speed: 0.8, pitch: -2 }),
  ], true);
  assert.deepEqual(tasks.map(({ voice, rate, pitch }) => ({ voice, rate, pitch })), [
    { voice: 'km-KH-SreymomNeural', rate: '+20%', pitch: '+0Hz' },
    { voice: 'km-KH-PisethNeural', rate: '+40%', pitch: '+0Hz' },
    { voice: 'km-KH-SreymomNeural', rate: '-20%', pitch: '-40Hz' },
  ]);
});

test('chunks long Khmer, supplementary characters and XML safely without data loss', () => {
  const text = 'ខ&🙂\'"'.repeat(1500);
  const chunks = splitText(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) {
    assert.ok(new TextEncoder().encode(escapeXml(chunk)).length <= MAX_ESCAPED_BYTES);
    assert.equal(chunk.includes('\uFFFD'), false);
  }
});

test('rejects invalid parts, settings, excess text and too many voice changes', () => {
  const bad = [
    [], {}, [{ text: 1 }], [part('hello', { voiceName: 'unknown' })],
    [part('hello', { speed: null })], [part('hello', { speed: 2.1 })],
    [part('hello', { pitch: 1.5 })], [part('hello', { pitch: 11 })],
    [part(' ')],
  ];
  for (const input of bad) assert.throws(() => prepareSegments(input), InputError);
  assert.throws(() => prepareSegments([part('x'.repeat(20001))]), error => error.status === 413);
  const manyVoices = Array.from({ length: 41 }, (_, index) => part('hello', { voiceName: index % 2 ? 'sreymom' : 'piseth' }));
  assert.throws(() => prepareSegments(manyVoices), error => error.status === 413);
});
