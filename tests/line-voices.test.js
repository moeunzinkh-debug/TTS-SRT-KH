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
    getBoundingClientRect() { return { top: 0 }; }
  }
  const editor = new Element();
  const gutter = new Element();
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
        return { top: mirror.textContent.slice(0, this.start).split('\n').length * 36 - 28, height: 19 };
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
  try {
    const controls = createLineVoiceControls({ editor, gutter, mirror, resetButton, status });
    flush();
    assert.deepEqual(gutter.children.map(element => Number(element.dataset.line)), [2, 6]);
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
    assert.equal(row(3).children[1].attributes['aria-pressed'], 'true');

    editor.selectionStart = 0;
    editor.selectionEnd = editor.value.length;
    editor.emit('beforeinput', { inputType: 'insertFromPaste' });
    editor.value = 'New document';
    editor.emit('input');
    flush();
    assert.equal(controls.getChoices().size, 0);
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
