import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLineVoices } from '../public/line-voices.js';

test('voice choices follow unchanged lines when lines are inserted or removed', () => {
  const previous = ['one', 'two', 'three'];
  const chosen = new Map([[1, 'sreymom'], [2, 'piseth']]);
  const inserted = ['one', 'new', 'two', 'three'];
  assert.deepEqual([...reconcileLineVoices(previous, inserted, chosen)], [[2, 'sreymom'], [3, 'piseth']]);
  assert.deepEqual([...reconcileLineVoices(inserted, previous, new Map([[2, 'sreymom'], [3, 'piseth']]))], [[1, 'sreymom'], [2, 'piseth']]);
});

test('editing a line keeps its choice; splitting copies it and joining keeps the first', () => {
  const chosen = new Map([[0, 'sreymom'], [1, 'piseth']]);
  assert.deepEqual([...reconcileLineVoices(['hello', 'next'], ['hello!', 'next'], chosen)], [...chosen]);
  assert.deepEqual([...reconcileLineVoices(['hello', 'next'], ['hel', 'lo', 'next'], chosen)], [
    [0, 'sreymom'], [1, 'sreymom'], [2, 'piseth'],
  ]);
  assert.deepEqual([...reconcileLineVoices(['hello', 'next'], ['hellonext'], chosen)], [[0, 'sreymom']]);
  assert.deepEqual([...reconcileLineVoices(['hello', 'next'], ['hellonext'], new Map([[1, 'piseth']]))], []);
});

test('choices on unchanged SRT dialogue survive edits to metadata or preceding blank lines', () => {
  const oldLines = ['', '1', '00:00:01,000 --> 00:00:03,000', 'សួស្តី', '', '2', '00:00:04,000 --> 00:00:05,000', 'សុខសប្បាយ'];
  const nextLines = ['1', '00:00:01,000 --> 00:00:03,000', 'សួស្តី', '', '2', '00:00:04,000 --> 00:00:05,000', 'សុខសប្បាយ'];
  assert.deepEqual([...reconcileLineVoices(oldLines, nextLines, new Map([[3, 'sreymom'], [7, 'piseth']]))], [[2, 'sreymom'], [6, 'piseth']]);
});

test('selection-anchored edits keep choices on repeated lines rather than newly inserted copies', () => {
  const choices = new Map([[0, 'sreymom'], [1, 'piseth'], [2, 'sreymom']]);
  const inserted = reconcileLineVoices(['A', 'A', 'A'], ['A', 'A', 'A', 'A'], choices,
    { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0 });
  assert.deepEqual([...inserted], [[1, 'sreymom'], [2, 'piseth'], [3, 'sreymom']]);
  const deleted = reconcileLineVoices(['A', 'A', 'B'], ['A', 'B'], choices,
    { startLine: 0, endLine: 1, startColumn: 0, endColumn: 0 });
  assert.deepEqual([...deleted], [[0, 'piseth'], [1, 'sreymom']]);
});

test('editor controls select voices, track edits and clear on document replacement', async () => {
  const { createLineVoiceControls } = await import('../public/line-voices.js');
  const originals = {
    document: globalThis.document, window: globalThis.window,
    getComputedStyle: globalThis.getComputedStyle, requestAnimationFrame: globalThis.requestAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };
  const frames = [];
  class Element {
    constructor() {
      this.value = '';
      this.textContent = '';
      this.dataset = {};
      this.style = {};
      this.attributes = {};
      this.children = [];
      this.listeners = {};
      this.clientWidth = 640;
      this.clientHeight = 300;
      this.scrollTop = 0;
      this.selectionStart = 0;
      this.selectionEnd = 0;
    }
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
    emit(name, properties = {}) { for (const handler of this.listeners[name] || []) handler(properties); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { child.parent = this; this.children.push(child); }
    insertBefore(child, next) {
      child.parent = this;
      const index = this.children.indexOf(next);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
    }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    get firstChild() { return this; }
    getBoundingClientRect() { return { top: 0, left: 0 }; }
  }
  const editor = new Element();
  const gutter = new Element();
  const settingsLayer = new Element();
  const mirror = new Element();
  const resetButton = new Element();
  const status = new Element();
  editor.value = '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nBye';
  globalThis.window = { addEventListener() {} };
  globalThis.document = {
    createElement: () => new Element(),
    createRange: () => ({
      setStart(_node, start) { this.start = start; },
      setEnd() {},
      getBoundingClientRect() {
        const before = mirror.textContent.slice(0, this.start);
        const left = before.split('\n').at(-1).length * 8;
        return { top: before.split('\n').length * 36 - 28, height: 19, left, right: left };
      },
    }),
  };
  globalThis.getComputedStyle = () => ({
    paddingLeft: '84px', paddingRight: '12px', paddingTop: '20px', font: '16px / 36px sans-serif',
    lineHeight: '36px', letterSpacing: 'normal', wordSpacing: 'normal', textIndent: '0px',
    textAlign: 'start', direction: 'ltr', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    wordBreak: 'normal', tabSize: '4',
  });
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  globalThis.ResizeObserver = undefined;
  const flush = () => { while (frames.length) frames.shift()(); };
  const row = line => gutter.children.find(element => Number(element.dataset.line) === line);
  const gear = line => settingsLayer.children.find(element => Number(element.dataset.line) === line);
  const opened = [];
  let changes = 0;
  try {
    const controls = createLineVoiceControls({ editor, gutter, settingsLayer, mirror, resetButton, status,
      openLineSettings: (line, button) => opened.push([line, button]), onDocumentChange: () => changes++ });
    flush();
    assert.deepEqual(gutter.children.map(element => Number(element.dataset.line)), [2, 6]);
    assert.deepEqual(settingsLayer.children.map(element => Number(element.dataset.line)), [2, 6]);
    gear(2).emit('click');
    assert.deepEqual(opened, [[2, gear(2)]]);
    assert.equal(controls.setLineSettings(2, { speed: 1.4, pitch: -3 }), true);
    assert.equal(gear(2).dataset.custom, 'true');
    assert.match(gear(2).attributes['aria-label'], /1.4x, pitch -3/);
    assert.equal(controls.setLineSettings(1, { speed: 1, pitch: 0 }), false); // Timestamp.
    assert.equal(controls.setLineSettings(2, { speed: 2.5, pitch: 0 }), false);
    const copied = controls.getSettings();
    copied.get(2).speed = 0.5;
    assert.equal(controls.getSettings().get(2).speed, 1.4);
    row(2).children[1].emit('click');
    row(6).children[0].emit('click');
    assert.deepEqual([...controls.getChoices()], [[2, 'sreymom'], [6, 'piseth']]);
    assert.equal(row(2).children[1].attributes['aria-pressed'], 'true');
    assert.equal(resetButton.disabled, false);

    editor.selectionStart = editor.selectionEnd = 0;
    editor.emit('beforeinput', { inputType: 'insertLineBreak' });
    editor.value = '\n' + editor.value;
    editor.emit('input');
    flush();
    assert.deepEqual([...controls.getChoices()], [[3, 'sreymom'], [7, 'piseth']]);
    assert.deepEqual([...controls.getSettings()], [[3, { speed: 1.4, pitch: -3 }]]);
    assert.equal(controls.getRevision(), 1);
    assert.equal(changes, 1);
    assert.equal(row(3).children[1].attributes['aria-pressed'], 'true');
    assert.equal(gear(3).dataset.custom, 'true');
    resetButton.emit('click');
    assert.equal(controls.getChoices().size, 0);
    assert.equal(controls.getSettings().get(3).speed, 1.4); // Voice reset is independent.
    assert.equal(controls.resetLineSettings(3), true);
    assert.equal(gear(3).dataset.custom, 'false');
    controls.setLineSettings(3, { speed: 1.4, pitch: -3 });

    editor.selectionStart = 0;
    editor.selectionEnd = editor.value.length;
    editor.emit('beforeinput', { inputType: 'insertFromPaste' });
    editor.value = 'New document';
    editor.emit('input');
    flush();
    assert.equal(controls.getChoices().size, 0);
    assert.equal(controls.getSettings().size, 0);
    assert.equal(resetButton.disabled, true);
    row(0).children[0].emit('click');
    resetButton.emit('click');
    assert.equal(controls.getChoices().size, 0);
    assert.equal(row(0).children[0].attributes['aria-pressed'], 'false');
    editor.value = '';
    editor.emit('input');
    controls.reset(); // Safe even before a pending render after removing lines.
    flush();
    assert.equal(gutter.children.length, 0);
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

test('speed and pitch choices reconcile on split, join, repeated lines and metadata edits', () => {
  const first = { speed: 1.3, pitch: -2 };
  const second = { speed: 0.8, pitch: 4 };
  const settings = new Map([[0, first], [1, second]]);
  assert.deepEqual([...reconcileLineVoices(['hello', 'next'], ['hel', 'lo', 'next'], settings)], [
    [0, first], [1, first], [2, second],
  ]);
  assert.deepEqual([...reconcileLineVoices(['hello', 'next'], ['hellonext'], settings)], [[0, first]]);
  assert.deepEqual([...reconcileLineVoices(['A', 'A'], ['A', 'A', 'A'], settings,
    { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0 })], [[1, first], [2, second]]);
  const oldLines = ['1', '00:00:01,000 --> 00:00:03,000', 'hello'];
  const nextLines = ['', '1', '00:00:01,000 --> 00:00:03,000', 'hello'];
  assert.deepEqual([...reconcileLineVoices(oldLines, nextLines, new Map([[2, first]]))], [[3, first]]);
});
