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
    [part('hello', { autoSpeed: 'false' })], [part('hello', { autoSpeed: null })],
    [part(' ')],
  ];
  for (const input of bad) assert.throws(() => prepareSegments(input), InputError);
  assert.throws(() => prepareSegments([part('x'.repeat(1000001))]), error => error.status === 413);
  const manyVoices = Array.from({ length: 6001 }, (_, index) => part('hello', { voiceName: index % 2 ? 'sreymom' : 'piseth' }));
  assert.throws(() => prepareSegments(manyVoices), error => error.status === 413);
});

test('supports the full 1,000,000-character maximum', () => {
  const tasks = prepareSegments([part('x'.repeat(1000000))]);
  assert.ok(tasks.length > 1);
  assert.ok(tasks.length <= 6000);
  // Khmer text (3 UTF-8 bytes per character) also fits under the task cap.
  const khmerTasks = prepareSegments([part('ខ'.repeat(1000000))]);
  assert.ok(khmerTasks.length <= 6000, `expected <=6000 tasks, got ${khmerTasks.length}`);
});

test('regression: a 124-cue SRT with Auto Speed ON no longer exceeds the segment cap', async () => {
  const { buildVoiceParts } = await import('../public/text.js');
  // Natural SRT cue lengths vary, so per-cue Auto Speed used to fragment
  // this into >40 tasks. Per-part Auto Speed must collapse it instead.
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let srt = '';
  for (let index = 1; index <= 124; index++) {
    srt += `${index}\n00:00:01,000 --> 00:00:02,000\n${'ខ'.repeat(10 + Math.floor(random() * 50))}\n\n`;
  }
  const voices = { piseth: { speed: 1, pitch: 0 }, sreymom: { speed: 1, pitch: 0 } };
  const tags = { piseth: { speed: 1, pitch: 0 }, sreymom: { speed: 1, pitch: 0 } };
  const parts = buildVoiceParts(srt, 'piseth', voices, tags, undefined, undefined, true);
  assert.equal(parts.length, 1);
  const tasks = prepareSegments(parts, true);
  assert.ok(tasks.length <= 10, `expected a handful of tasks, got ${tasks.length}`);
  assert.equal(tasks[0].rate, '+40%'); // Whole long part speeds up as one run.
});

test('regression: dialogue alternating voices on every cue fits under the raised cap', () => {
  const alternating = Array.from({ length: 124 }, (_, index) => part('ខ'.repeat(20), { voiceName: index % 2 ? 'sreymom' : 'piseth' }));
  const tasks = prepareSegments(alternating);
  assert.equal(tasks.length, 124);
});

test('regression: a 300-cue SRT fits in one run in every common configuration', async () => {
  const { buildVoiceParts } = await import('../public/text.js');
  const voices = { piseth: { speed: 1, pitch: 0 }, sreymom: { speed: 1, pitch: 0 } };
  const tags = { piseth: { speed: 1, pitch: 0 }, sreymom: { speed: 1, pitch: 0 } };
  let srt = '';
  for (let index = 1; index <= 300; index++) {
    srt += `${index}\n00:00:01,000 --> 00:00:02,000\n${'ខ'.repeat(20)}\n\n`;
  }
  // Single voice, Auto Speed ON.
  const single = buildVoiceParts(srt, 'piseth', voices, tags, undefined, undefined, true);
  assert.ok(prepareSegments(single, true).length <= 1000);
  // Alternating Piseth/Sreymom per cue: worst case, one task per cue.
  const overrides = new Map();
  for (let index = 0; index < 300; index++) overrides.set(index * 4 + 2, index % 2 ? 'sreymom' : 'piseth');
  const alternating = buildVoiceParts(srt, 'piseth', voices, tags, overrides, undefined, false);
  assert.equal(alternating.length, 300);
  assert.equal(prepareSegments(alternating).length, 300);
  // Every cue with a unique manual speed/pitch.
  const settings = new Map();
  for (let index = 0; index < 300; index++) settings.set(index * 4 + 2, { speed: 0.5 + (index % 16) * 0.1, pitch: (index % 21) - 10 });
  const customized = buildVoiceParts(srt, 'piseth', voices, tags, undefined, settings, false);
  assert.equal(prepareSegments(customized).length, 300);
});

test('regression: a 5,000-cue SRT fits in one run in every common configuration', async () => {
  const { buildVoiceParts } = await import('../public/text.js');
  const voices = { piseth: { speed: 1, pitch: 0 }, sreymom: { speed: 1, pitch: 0 } };
  const tags = { piseth: { speed: 1, pitch: 0 }, sreymom: { speed: 1, pitch: 0 } };
  let srt = '';
  for (let index = 1; index <= 5000; index++) {
    srt += `${index}\n00:00:01,000 --> 00:00:02,000\n${'ខ'.repeat(20)}\n\n`;
  }
  // Single voice, Auto Speed ON: collapses to a handful of tasks.
  const single = buildVoiceParts(srt, 'piseth', voices, tags, undefined, undefined, true);
  assert.ok(prepareSegments(single, true).length <= 6000);
  // Alternating Piseth/Sreymom per cue: worst case, exactly 5,000 tasks.
  const overrides = new Map();
  for (let index = 0; index < 5000; index++) overrides.set(index * 4 + 2, index % 2 ? 'sreymom' : 'piseth');
  const alternating = buildVoiceParts(srt, 'piseth', voices, tags, overrides, undefined, false);
  assert.equal(alternating.length, 5000);
  assert.equal(prepareSegments(alternating).length, 5000);
  // 6,001 alternating cues still exceed the cap.
  const tooMany = Array.from({ length: 6001 }, (_, index) => part('ខ'.repeat(20), { voiceName: index % 2 ? 'sreymom' : 'piseth' }));
  assert.throws(() => prepareSegments(tooMany), error => error.status === 413);
});

test('per-part Auto Speed overrides the global flag without changing older requests', () => {
  const long = 'ខ'.repeat(46);
  const tasks = prepareSegments([
    part(long), part(long, { autoSpeed: false, pitch: 2 }), part(long, { autoSpeed: true, pitch: -2 }),
  ], true);
  assert.deepEqual(tasks.map(({ rate, pitch }) => [rate, pitch]), [
    ['+40%', '+0Hz'], ['+0%', '+40Hz'], ['+40%', '-40Hz'],
  ]);
  assert.equal(prepareSegments([part(long, { autoSpeed: true })], false)[0].rate, '+40%');
  assert.equal(prepareSegments([part(long)], false)[0].rate, '+0%');
});
