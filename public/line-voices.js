import { hasSpokenText, isSrtMetadata } from './text.js';

const BUTTON_HEIGHT = 32;
const VOICES = [
    { id: 'piseth', symbol: '♂', label: 'សំឡេងប្រុស (Piseth)' },
    { id: 'sreymom', symbol: '♀', label: 'សំឡេងស្រី (Sreymom)' },
];

// Keep choices on unchanged lines when users edit, insert, or delete lines.
// When one line is split, both pieces retain its voice; when lines are joined,
// the resulting line keeps the first line's choice.
export function reconcileLineVoices(previous, next, choices, edit = null) {
    if (!choices.size) return new Map();
    let prefix = 0;
    const prefixLimit = edit ? edit.startLine : Infinity;
    while (prefix < prefixLimit && prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
    let oldEnd = previous.length;
    let newEnd = next.length;
    let suffix = 0;
    const suffixLimit = edit ? previous.length - edit.endLine - 1 : Infinity;
    while (suffix < suffixLimit && oldEnd > prefix && newEnd > prefix && previous[oldEnd - 1] === next[newEnd - 1]) {
        oldEnd--;
        newEnd--;
        suffix++;
    }
    const oldCount = oldEnd - prefix;
    const newCount = newEnd - prefix;
    const result = new Map();
    for (const [index, voice] of choices) {
        if (index < 0 || index >= previous.length) continue;
        if (index < prefix) result.set(index, voice);
        else if (index >= oldEnd) result.set(index + next.length - previous.length, voice);
        else if (oldCount === 1 && newCount > 1) {
            // Inserting whole lines at a boundary should not give those new lines
            // the old line's choice, even when their text is identical.
            if (edit && edit.startColumn === 0 && edit.endColumn === 0 && next[newEnd - 1] === previous[index]) {
                result.set(newEnd - 1, voice);
            } else if (edit && edit.startColumn === previous[index].length &&
                edit.endColumn === previous[index].length && next[prefix] === previous[index]) {
                result.set(prefix, voice);
            } else {
                for (let i = prefix; i < newEnd; i++) result.set(i, voice);
            }
        } else if (oldCount > 1 && newCount === 1 && edit && edit.startColumn === 0 &&
            edit.endColumn === 0 && next[prefix] === previous[oldEnd - 1]) {
            if (index === oldEnd - 1) result.set(prefix, voice);
        } else if (index - prefix < newCount) {
            result.set(index, voice);
        }
    }
    return result;
}

function lineStarts(lines) {
    const starts = new Uint32Array(lines.length);
    let position = 0;
    for (let index = 0; index < lines.length; index++) {
        starts[index] = position;
        position += lines[index].length + 1;
    }
    return starts;
}

// Anchor a contiguous edit to the selection to disambiguate repeated lines.
// If the browser changed a different range (e.g. some undo/delete actions),
// fall back to comparing unchanged lines instead.
function selectionEdit(previous, next, starts, selection) {
    if (!selection) return null;
    const { start, end } = selection;
    const insertedLength = next.length - (previous.length - (end - start));
    if (insertedLength < 0 || previous.slice(0, start) !== next.slice(0, start) ||
        previous.slice(end) !== next.slice(start + insertedLength)) return null;
    function lineAt(position) {
        let low = 0;
        let high = starts.length;
        while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            if (starts[middle] <= position) low = middle;
            else high = middle;
        }
        return low;
    }
    const startLine = lineAt(start);
    const endLine = lineAt(end);
    return { startLine, endLine, startColumn: start - starts[startLine], endColumn: end - starts[endLine] };
}

// A hidden mirror measures wrapping exactly like the textarea. Only controls
// for visible lines are rendered, so long SRT files do not create thousands of
// buttons. The text itself remains a normal textarea for editing and pasting.
export function createLineVoiceControls({ editor, gutter, mirror, resetButton, status }) {
    let previousValue = editor.value;
    let lines = previousValue.split('\n');
    let starts = lineStarts(lines);
    let choices = new Map();
    let beforeInput = null;
    let frame = 0;
    let mirroredValue = null;
    const rows = new Map();
    const range = document.createRange();

    function scheduleRender() {
        if (!frame) frame = requestAnimationFrame(render);
    }

    function updateResetButton() {
        resetButton.disabled = choices.size === 0;
    }

    function updateRow(row, index) {
        row.dataset.line = String(index);
        const preview = (lines[index] || '').slice(0, 160).replace(/<\/?[A-Za-z][^>]*>/g, '')
            .replace(/\s+/g, ' ').trim().slice(0, 50);
        for (const button of row.children) {
            const voice = VOICES.find(item => item.id === button.dataset.voice);
            const selected = choices.get(index) === voice.id;
            button.setAttribute('aria-pressed', String(selected));
            button.setAttribute('aria-label', `${voice.label} សម្រាប់ជួរទី ${index + 1}: ${preview}`);
            button.title = selected
                ? `${voice.label} — ចុចម្ដងទៀតដើម្បីប្រើសំឡេងគោល ឬ Tag`
                : `${voice.label} សម្រាប់ជួរទី ${index + 1}`;
        }
    }

    function createRow(index) {
        const row = document.createElement('div');
        row.className = 'voice-line-controls';
        for (const voice of VOICES) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'voice-line-button';
            button.dataset.voice = voice.id;
            button.textContent = voice.symbol;
            button.addEventListener('click', () => {
                const line = Number(row.dataset.line);
                if (choices.get(line) === voice.id) choices.delete(line);
                else choices.set(line, voice.id);
                updateRow(row, line);
                updateResetButton();
                status.textContent = choices.has(line)
                    ? `ជួរទី ${line + 1}៖ ${voice.label}`
                    : `ជួរទី ${line + 1}៖ ប្រើសំឡេងគោល ឬ Tag`;
            });
            row.appendChild(button);
        }
        updateRow(row, index);
        return row;
    }

    function render() {
        frame = 0;
        const style = getComputedStyle(editor);
        const width = Math.max(1, editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
        Object.assign(mirror.style, {
            width: `${width}px`, font: style.font, lineHeight: style.lineHeight,
            letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing,
            textIndent: style.textIndent, textAlign: style.textAlign, direction: style.direction,
            whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap,
            wordBreak: style.wordBreak, tabSize: style.tabSize,
        });
        if (mirroredValue !== previousValue) {
            mirror.textContent = previousValue + '\u200B'; // Measure the final empty line too.
            mirroredValue = previousValue;
        }
        const mirrorTop = mirror.getBoundingClientRect().top;
        const paddingTop = parseFloat(style.paddingTop);
        const positions = new Map();
        function positionOf(index) {
            if (positions.has(index)) return positions.get(index);
            const start = starts[index];
            const codePoint = previousValue.codePointAt(start);
            range.setStart(mirror.firstChild, start);
            range.setEnd(mirror.firstChild, start + (codePoint > 0xffff ? 2 : 1));
            const rect = range.getBoundingClientRect();
            const top = paddingTop + rect.top - mirrorTop + (rect.height - BUTTON_HEIGHT) / 2;
            positions.set(index, top);
            return top;
        }

        const visibleTop = editor.scrollTop;
        const visibleBottom = visibleTop + editor.clientHeight;
        let low = 0;
        let high = lines.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (positionOf(middle) + BUTTON_HEIGHT < visibleTop) low = middle + 1;
            else high = middle;
        }

        const visible = new Set();
        for (let index = low; index < lines.length; index++) {
            const top = positionOf(index);
            if (top > visibleBottom) break;
            if (isSrtMetadata(lines, index) || !hasSpokenText(lines[index])) continue;
            visible.add(index);
            let row = rows.get(index);
            if (!row) {
                row = createRow(index);
                rows.set(index, row);
                const next = Array.from(gutter.children).find(child => Number(child.dataset.line) > index);
                gutter.insertBefore(row, next || null);
            } else updateRow(row, index);
            row.style.top = `${top - visibleTop}px`;
        }
        for (const [index, row] of rows) {
            if (!visible.has(index)) {
                row.remove();
                rows.delete(index);
            }
        }
    }

    function reset() {
        choices = new Map();
        for (const [index, row] of rows) updateRow(row, index);
        status.textContent = '';
        updateResetButton();
        scheduleRender();
    }

    editor.addEventListener('beforeinput', event => {
        beforeInput = { start: editor.selectionStart, end: editor.selectionEnd, type: event.inputType || '' };
    });
    editor.addEventListener('input', () => {
        const nextValue = editor.value;
        const nextLines = nextValue.split('\n');
        const replacedAll = beforeInput && previousValue.length > 0 && beforeInput.start === 0 &&
            beforeInput.end === previousValue.length && beforeInput.type.startsWith('insert') && nextValue !== previousValue;
        const edit = choices.size ? selectionEdit(previousValue, nextValue, starts, beforeInput) : null;
        choices = replacedAll ? new Map() : reconcileLineVoices(lines, nextLines, choices, edit);
        beforeInput = null;
        previousValue = nextValue;
        lines = nextLines;
        starts = lineStarts(lines);
        // Old buttons must not target stale line numbers before the next paint.
        for (const row of rows.values()) row.remove();
        rows.clear();
        updateResetButton();
        scheduleRender();
    });
    editor.addEventListener('scroll', scheduleRender, { passive: true });
    resetButton.addEventListener('click', () => {
        reset();
        status.textContent = 'ប្រើសំឡេងគោល ឬ Tag សម្រាប់គ្រប់ជួរ';
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleRender).observe(editor);
    window.addEventListener('resize', scheduleRender);
    document.fonts?.addEventListener('loadingdone', scheduleRender);
    updateResetButton();
    scheduleRender();

    return { getChoices: () => new Map(choices), reset };
}
