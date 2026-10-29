import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceParts, getLineInheritedSettings, splitDialogue, stripSrtMetadata } from '../public/text.js';
import { prepareSegments } from '../worker/prepare.js';

const voices = {
  piseth: { speed: 0.9, pitch: 1 },
  sreymom: { speed: 1, pitch: 0 },
};
const tags = {
  piseth: { speed: 1, pitch: 0 },
  sreymom: { speed: 1.1, pitch: -1 },
};

test('SRT metadata is removed with CRLF, BOM, timing options and multiline cues', () => {
  const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:04,000\r\nសួស្តី\r\nពិភពលោក\r\n\r\n2\r\n00:00:05.000 --> 00:00:07.000 align:start\r\nថ្ងៃនេះ\r\n';
  assert.deepEqual(splitDialogue(srt), ['សួស្តី ពិភពលោក', 'ថ្ងៃនេះ']);
  assert.equal(stripSrtMetadata('There are\n42\npeople.'), 'There are\n42\npeople.');
});

test('speaker tags keep their voice, attribute order and surrounding SRT dialogue', () => {
  const srt = '1\n00:00:00,000 --> 00:00:03,000\nជំរាបសួរ <sreymom pitch="-3" speed="1.3">បងប្អូន</sreymom> ទាំងអស់\n\n2\n00:00:04,000 --> 00:00:06,000\n<i>សុខសប្បាយ</i>';
  const parts = buildVoiceParts(srt, 'piseth', voices, tags);
  assert.deepEqual(parts, [
    { text: 'ជំរាបសួរ', voiceName: 'piseth', speed: 0.9, pitch: 1 },
    { text: 'បងប្អូន', voiceName: 'sreymom', speed: 1.3, pitch: -3 },
    { text: 'ទាំងអស់\n\n<i>សុខសប្បាយ</i>', voiceName: 'piseth', speed: 0.9, pitch: 1 },
  ]);
});

test('only known voice tags are interpreted, defaults and single quotes work', () => {
  const parts = buildVoiceParts('<i>hello</i> <SREYMOM>world</SREYMOM> <piseth pitch=\'2\'>friend</piseth>', 'piseth', voices, tags);
  assert.deepEqual(parts.map(part => [part.text, part.voiceName, part.speed, part.pitch]), [
    ['<i>hello</i>', 'piseth', 0.9, 1],
    ['world', 'sreymom', 1.1, -1],
    ['friend', 'piseth', 1, 2],
  ]);
});

test('per-line voices follow source lines, not SRT numbers or timestamps', () => {
  const input = '\n1\n00:00:01,000 --> 00:00:03,000\nសួស្តី\nបន្ទាត់ពីរ\n\n2\n00:00:04,000 --> 00:00:06,000\nជំរាបលា';
  const overrides = new Map([[3, 'sreymom'], [4, 'piseth'], [8, 'sreymom']]);
  assert.deepEqual(buildVoiceParts(input, 'piseth', voices, tags, overrides), [
    { text: 'សួស្តី', voiceName: 'sreymom', speed: 1, pitch: 0 },
    { text: 'បន្ទាត់ពីរ', voiceName: 'piseth', speed: 0.9, pitch: 1 },
    { text: 'ជំរាបលា', voiceName: 'sreymom', speed: 1, pitch: 0 },
  ]);
});

test('per-line choices override that whole line but preserve existing tags elsewhere', () => {
  const input = 'Before\n<sreymom speed="1.3" pitch="-2">first\nsecond</sreymom> after\nLast';
  const overrides = new Map([[2, 'piseth'], [3, 'sreymom']]);
  assert.deepEqual(buildVoiceParts(input, 'piseth', voices, tags, overrides), [
    { text: 'Before', voiceName: 'piseth', speed: 0.9, pitch: 1 },
    { text: 'first', voiceName: 'sreymom', speed: 1.3, pitch: -2 },
    { text: 'second after', voiceName: 'piseth', speed: 0.9, pitch: 1 },
    { text: 'Last', voiceName: 'sreymom', speed: 1, pitch: 0 },
  ]);
});

test('adjacent lines with the same selected voice are batched', () => {
  const input = Array.from({ length: 250 }, (_, index) => `Line ${index + 1}`).join('\n');
  const overrides = new Map(Array.from({ length: 250 }, (_, index) => [index, 'sreymom']));
  const parts = buildVoiceParts(input, 'piseth', voices, tags, overrides);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, input);
  assert.equal(parts[0].voiceName, 'sreymom');
});

test('only cue numbers, timestamps and non-spoken lines omit voice controls', async () => {
  const { isSrtMetadata, hasSpokenText } = await import('../public/text.js');
  const lines = ['\uFEFF1', '00:00:01,000 --> 00:00:04,000', '42', '<i>សួស្តី</i>', '<sreymom>', '  ', '00:00:05.000 --> 00:00:06.000 align:start'];
  assert.deepEqual(lines.map((line, index) => !isSrtMetadata(lines, index) && hasSpokenText(line)), [false, false, true, true, false, false, false]);
});

test('selected line voices reach the Worker as ordered Khmer voices with their main settings', () => {
  const input = '1\n00:00:00,000 --> 00:00:02,000\nប្រុស\n\n2\n00:00:02,000 --> 00:00:04,000\nស្រី\n\n3\n00:00:04,000 --> 00:00:06,000\nប្រុសម្ដងទៀត';
  const parts = buildVoiceParts(input, 'piseth', voices, tags, new Map([[2, 'piseth'], [6, 'sreymom'], [10, 'piseth']]));
  const tasks = prepareSegments(parts);
  assert.deepEqual(tasks.map(({ text, voice, rate, pitch }) => [text, voice, rate, pitch]), [
    ['ប្រុស', 'km-KH-PisethNeural', '-10%', '+20Hz'],
    ['ស្រី', 'km-KH-SreymomNeural', '+0%', '+0Hz'],
    ['ប្រុសម្ដងទៀត', 'km-KH-PisethNeural', '-10%', '+20Hz'],
  ]);
});

test('per-line speed and pitch override only that line while retaining voice tags', () => {
  const input = '1\n00:00:01,000 --> 00:00:03,000\n<sreymom speed="1.3" pitch="-2">first\nsecond</sreymom> after\n\n2\n00:00:04,000 --> 00:00:05,000\nlast';
  const settings = new Map([[3, { speed: 0.7, pitch: 4 }]]);
  assert.deepEqual(buildVoiceParts(input, 'piseth', voices, tags, undefined, settings), [
    { text: 'first', voiceName: 'sreymom', speed: 1.3, pitch: -2 },
    { text: 'second', voiceName: 'sreymom', speed: 0.7, pitch: 4 },
    { text: 'after', voiceName: 'piseth', speed: 0.7, pitch: 4 },
    { text: 'last', voiceName: 'piseth', speed: 0.9, pitch: 1 },
  ]);
  const chosen = new Map([[3, 'piseth']]);
  assert.deepEqual(buildVoiceParts(input, 'piseth', voices, tags, chosen, settings).map(p => [p.text, p.voiceName, p.speed, p.pitch]), [
    ['first', 'sreymom', 1.3, -2], ['second after', 'piseth', 0.7, 4], ['last', 'piseth', 0.9, 1],
  ]);
});

test('custom 1.0x line speed stays fixed when Auto Speed is enabled', () => {
  const long = 'ខ'.repeat(46);
  const text = `${long}\n${long}`;
  const settings = new Map([[1, { speed: 1, pitch: 0 }]]);
  const parts = buildVoiceParts(text, 'sreymom', voices, tags, undefined, settings, true);
  assert.deepEqual(parts.map(({ speed, autoSpeed }) => [speed, autoSpeed]), [[1, undefined], [1, false]]);
  assert.deepEqual(prepareSegments(parts, true).map(({ rate }) => rate), ['+40%', '+0%']);
  // Without Auto Speed, equal adjacent settings can still be batched.
  assert.equal(buildVoiceParts(text, 'sreymom', voices, tags, undefined, settings, false).length, 1);
});

test('line settings dialog inherits explicit voice choices and tags spanning lines', () => {
  const input = '1\n00:00:01,000 --> 00:00:03,000\n<sreymom speed="1.3" pitch="-2">first\nsecond</sreymom> after\nplain';
  assert.deepEqual(getLineInheritedSettings(input, 2, 'piseth', voices, tags), { speed: 1.3, pitch: -2 });
  assert.deepEqual(getLineInheritedSettings(input, 3, 'piseth', voices, tags), { speed: 1.3, pitch: -2 });
  assert.deepEqual(getLineInheritedSettings(input, 3, 'piseth', voices, tags, new Map([[3, 'piseth']])), { speed: 0.9, pitch: 1 });
  assert.deepEqual(getLineInheritedSettings(input, 4, 'piseth', voices, tags), { speed: 0.9, pitch: 1 });
  assert.deepEqual(getLineInheritedSettings('<sreymom speed="bad" pitch="20">oops</sreymom>', 0, 'piseth', voices, tags), { speed: 0.9, pitch: 1 });
});
