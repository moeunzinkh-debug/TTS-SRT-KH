import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceParts, splitDialogue, stripSrtMetadata } from '../public/text.js';

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
