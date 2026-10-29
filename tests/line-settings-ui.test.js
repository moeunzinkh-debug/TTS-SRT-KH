import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the browser module and the real line controller together, with a
// small DOM and mocked synthesis. Layout is covered by browser tests separately.
const frames = [];
const listeners = {};
let document;
class Element {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerText = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.parent = null;
    this.isConnected = true;
    this.clientWidth = 640;
    this.clientHeight = 300;
    this.scrollTop = 0;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.disabled = false;
    const classes = new Set(['settings-modal', 'line-settings-hint', 'line-settings-reset', 'audio-container', 'loader'].includes(id) ? ['hidden'] : []);
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    };
  }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatchEvent(event) { for (const handler of this.listeners[event.type] || []) handler(event); return true; }
  click() { this.focus(); this.dispatchEvent({ type: 'click' }); }
  focus() { document.activeElement = this; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.parent = this; this.children.push(child); }
  insertBefore(child, next) {
    child.parent = this;
    const index = this.children.indexOf(next);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
  }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.isConnected = false; }
  get firstChild() { return this; }
  getBoundingClientRect() { return { top: 0, left: 0 }; }
  play() { return Promise.reject(new Error('autoplay blocked')); }
}
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, new Element(id));
  return elements.get(id);
}
document = {
  activeElement: null,
  documentElement: new Element('html'),
  getElementById: element,
  createElement: () => new Element(),
  addEventListener: (name, handler) => (listeners[name] ||= []).push(handler),
  createRange: () => ({
    setStart(_node, start) { this.start = start; }, setEnd() {},
    getBoundingClientRect() {
      const before = element('voice-line-mirror').textContent.slice(0, this.start);
      const left = before.split('\n').at(-1).length * 8;
      return { top: before.split('\n').length * 36 - 28, height: 19, left, right: left };
    },
  }),
};
globalThis.window = globalThis;
globalThis.document = document;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
globalThis.getComputedStyle = () => ({
  paddingLeft: '84px', paddingRight: '48px', paddingTop: '20px', font: '16px / 36px sans-serif',
  lineHeight: '36px', letterSpacing: 'normal', wordSpacing: 'normal', textIndent: '0px',
  textAlign: 'start', direction: 'ltr', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  wordBreak: 'normal', tabSize: '4',
});
globalThis.localStorage = { getItem: () => 'light', setItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.lucide = { createIcons() {} };
globalThis.alert = message => { throw new Error(message); };
URL.createObjectURL = () => 'blob:mock-audio';
URL.revokeObjectURL = () => {};
await import('../public/script.js');
for (const handler of listeners.DOMContentLoaded) handler();
const flush = () => { while (frames.length) frames.shift()(); };
const gear = line => element('line-settings-layer').children.find(button => Number(button.dataset.line) === line);
flush();

test('line modal saves independent settings and sends an Auto Speed override to Generate', async () => {
  const editor = element('editor');
  const long = 'ខ'.repeat(46);
  editor.value = `hello\n${long}`;
  editor.dispatchEvent(new Event('input'));
  flush();
  const first = gear(0);
  first.click();
  assert.equal(element('settings-modal').classList.contains('hidden'), false);
  assert.equal(document.activeElement.id, 'input-speed');
  element('input-speed').value = '1';
  element('input-pitch').value = '3';
  window.saveSettings();
  assert.equal(first.dataset.custom, 'true');
  assert.equal(document.activeElement, first);
  assert.equal(editor.value, `hello\n${long}`);

  window.toggleAutoSpeed();
  let body;
  globalThis.fetch = async (_url, options) => {
    body = options.body;
    return new Response(Uint8Array.of(1, 2), { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  await window.generateAudio();
  assert.equal(body.get('autoSpeed'), 'true');
  assert.deepEqual(JSON.parse(body.get('data')).map(p => [p.text, p.speed, p.pitch, p.autoSpeed]), [
    ['hello', 1, 3, false], [long, 1, 0, undefined],
  ]);

  first.click();
  assert.equal(Number(element('input-pitch').value), 3);
  element('input-pitch').value = '-5';
  window.closeSettings(); // Cancel must not save.
  first.click();
  assert.equal(Number(element('input-pitch').value), 3);
  window.resetLineSettings();
  assert.equal(first.dataset.custom, 'false');
});

test('editing while a line modal is open invalidates its target and restores focus', () => {
  const editor = element('editor');
  gear(0).click();
  editor.value = 'replacement';
  editor.dispatchEvent(new Event('input'));
  flush();
  assert.equal(element('settings-modal').classList.contains('hidden'), true);
  assert.equal(document.activeElement, editor);
  assert.equal(gear(0).dataset.custom, 'false');
  window.saveSettings(); // A stale target cannot apply to the replacement.
  assert.equal(gear(0).dataset.custom, 'false');
});
