import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual browser module with a small DOM and mocked fetch.
const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const classes = new Set(id === 'audio-container' ? ['hidden'] : []);
    elements.set(id, {
      value: '', disabled: false, attributes: {}, events: [], focused: false,
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      dispatchEvent(event) { this.events.push(event); return true; },
      focus() { this.focused = true; },
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
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await window.generateAudio();
  } finally {
    console.error = originalError;
  }
  assert.match(logged[0][1].message, /Edge TTS unavailable/);
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

function uploadInput(file) {
  return { files: file ? [file] : [], value: 'selected file' };
}

test('uploading a UTF-8 SRT loads the editor and works with Generate', async () => {
  const editor = element('editor');
  editor.value = '';
  editor.events = [];
  editor.focused = false;
  let confirmations = 0;
  globalThis.confirm = () => { confirmations++; return true; };
  const input = uploadInput(new File(['\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\nសួស្តី\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nអ្នក'], 'dialogue.SRT', { type: 'application/octet-stream' }));
  await window.uploadTextFile({ target: input });
  assert.equal(input.value, '');
  assert.equal(editor.value, '1\n00:00:01,000 --> 00:00:03,000\nសួស្តី\n\n2\n00:00:04,000 --> 00:00:05,000\nអ្នក');
  assert.equal(editor.focused, true);
  assert.equal(editor.events.at(-1).type, 'input');
  assert.equal(editor.events.at(-1).bubbles, true);
  await window.uploadTextFile({ target: input }); // CRLF content matches the normalized textarea.
  assert.equal(editor.value, '1\n00:00:01,000 --> 00:00:03,000\nសួស្តី\n\n2\n00:00:04,000 --> 00:00:05,000\nអ្នក');
  assert.equal(confirmations, 0); // Neither an empty editor nor identical content should prompt.

  let body;
  globalThis.fetch = async (_url, options) => {
    body = options.body;
    return new Response(Uint8Array.of(0xff, 0xf3), { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  await window.generateAudio();
  const parts = JSON.parse(body.get('data'));
  assert.equal(parts.length, 1);
  assert.equal(parts[0].text, 'សួស្តី\n\nអ្នក');
});

test('text upload confirms before replacing existing content and allows reselecting the same file', async () => {
  const editor = element('editor');
  editor.value = 'អត្ថបទចាស់';
  const file = new File(['អត្ថបទថ្មី'], 'notes.txt', { type: 'text/plain' });
  let confirmations = 0;
  globalThis.confirm = () => { confirmations++; return false; };
  const input = uploadInput(file);
  await window.uploadTextFile({ target: input });
  assert.equal(editor.value, 'អត្ថបទចាស់');
  assert.equal(input.value, '');
  assert.equal(confirmations, 1);

  input.value = 'selected again';
  globalThis.confirm = () => { confirmations++; return true; };
  await window.uploadTextFile({ target: input });
  assert.equal(editor.value, 'អត្ថបទថ្មី');
  assert.equal(input.value, '');
  assert.equal(confirmations, 2);

  await window.uploadTextFile({ target: input });
  assert.equal(confirmations, 2); // Identical content does not need confirmation.
});

test('UTF-16 BOM files are decoded for both byte orders', async () => {
  const editor = element('editor');
  globalThis.confirm = () => true;
  const text = 'សួស្តី Khmer';
  const littleEndian = Buffer.from(text, 'utf16le');
  const bigEndian = Buffer.from(littleEndian);
  bigEndian.swap16();
  for (const bytes of [Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian]), Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])]) {
    editor.value = '';
    await window.uploadTextFile({ target: uploadInput(new File([bytes], 'voice.txt')) });
    assert.equal(editor.value, text);
  }
});

test('invalid, empty, oversized, unreadable, and cancelled uploads preserve existing text', async () => {
  const editor = element('editor');
  editor.value = 'keep this';
  let confirmations = 0;
  globalThis.confirm = () => { confirmations++; return false; };
  alerts.length = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    const files = [
      new File(['binary'], 'photo.png', { type: 'image/png' }),
      new File(['  \n'], 'empty.srt'),
      new File([Uint8Array.of(0xff, 0x00, 0xff)], 'bad.txt'),
      new File(['binary\0data'], 'bad.srt'),
      { name: 'huge.txt', type: 'text/plain', size: 5 * 1024 * 1024 + 1, arrayBuffer: () => { throw new Error('oversized file was read'); } },
      { name: 'unreadable.txt', type: 'text/plain', size: 1, arrayBuffer: async () => { throw new Error('read failed'); } },
    ];
    for (const file of files) {
      const input = uploadInput(file);
      await window.uploadTextFile({ target: input });
      assert.equal(input.value, '');
      assert.equal(editor.value, 'keep this');
    }
    assert.equal(alerts.length, files.length);
    assert.equal(confirmations, 0);
    assert.match(alerts[0], /SRT ឬ TXT/);
    assert.match(alerts[4], /5 MB/);
    const input = uploadInput(null);
    await window.uploadTextFile({ target: input });
    assert.equal(input.value, '');
    assert.equal(editor.value, 'keep this');
    assert.equal(alerts.length, files.length);
  } finally {
    console.error = originalError;
    alerts.length = 0;
  }
});

test('an older file read cannot overwrite a newer upload or undo Clear', async () => {
  const editor = element('editor');
  globalThis.confirm = () => true;
  let finishFirst;
  const firstFile = { name: 'first.txt', type: 'text/plain', size: 1, arrayBuffer: () => new Promise(resolve => { finishFirst = resolve; }) };
  editor.value = '';
  const first = window.uploadTextFile({ target: uploadInput(firstFile) });
  await window.uploadTextFile({ target: uploadInput(new File(['newer'], 'second.txt')) });
  finishFirst(new TextEncoder().encode('older').buffer);
  await first;
  assert.equal(editor.value, 'newer');

  let finishSecond;
  const pendingFile = { name: 'pending.txt', type: 'text/plain', size: 1, arrayBuffer: () => new Promise(resolve => { finishSecond = resolve; }) };
  const pending = window.uploadTextFile({ target: uploadInput(pendingFile) });
  window.clearEditor();
  finishSecond(new TextEncoder().encode('should not return').buffer);
  await pending;
  assert.equal(editor.value, '');
});
