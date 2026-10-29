import { hasSpokenText, isSrtMetadata } from './text.js';

const BUTTON_HEIGHT = 32;
const VOICES = [
    { id: 'piseth', symbol: '♂', label: 'សំឡេងប្រុស (Piseth)' },
    { id: 'sreymom', symbol: '♀', label: 'សំឡេងស្រី (Sreymom)' },
];

// Keep choices on unchanged lines when users edit, insert, or delete lines.
// When one line is split, both pieces retain its choices; when lines are joined,
// the resulting line keeps the first line's choices.
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
export function createLineVoiceControls({ editor, gutter, settingsLayer, mirror, resetButton, status, openLineSettings, onDocumentChange }) {
    let previousValue = editor.value;
    let lines = previousValue.split('\n');
    let starts = lineStarts(lines);
    let choices = new Map();
    let lineSettings = new Map();
    let revision = 0;
    let beforeInput = null;
    let frame = 0;
    let mirroredValue = null;
    const rows = new Map();
    const settingsButtons = new Map();
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

    function updateSettingsButton(button, index) {
        button.dataset.line = String(index);
        const settings = lineSettings.get(index);
        const preview = (lines[index] || '').slice(0, 160).replace(/<\/?[A-Za-z][^>]*>/g, '')
            .replace(/\s+/g, ' ').trim().slice(0, 50);
        const detail = settings ? `${settings.speed.toFixed(1)}x, pitch ${settings.pitch}` : 'គោល ឬ Tag';
        button.dataset.custom = String(Boolean(settings));
        button.setAttribute('aria-label', `កំណត់ល្បឿន និង pitch សម្រាប់ជួរទី ${index + 1}: ${preview} (${detail})`);
        button.title = `ល្បឿន និង pitch សម្រាប់ជួរទី ${index + 1} (${detail})`;
    }

    function createSettingsButton(index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'line-settings-button';
        button.textContent = '⚙️';
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () => openLineSettings?.(Number(button.dataset.line), button));
        updateSettingsButton(button, index);
        return button;
    }

    function isSpokenLine(index) {
        return Number.isInteger(index) && index >= 0 && index < lines.length &&
            !isSrtMetadata(lines, index) && hasSpokenText(lines[index]);
    }

    function setLineSettings(index, settings) {
        if (!isSpokenLine(index) || !Number.isFinite(settings?.speed) || settings.speed < 0.5 || settings.speed > 2 ||
            !Number.isInteger(settings.pitch) || settings.pitch < -10 || settings.pitch > 10) return false;
        lineSettings.set(index, { speed: settings.speed, pitch: settings.pitch });
        const button = settingsButtons.get(index);
        if (button) updateSettingsButton(button, index);
        status.textContent = `ជួរទី ${index + 1}៖ ល្បឿន ${settings.speed.toFixed(1)}x, pitch ${settings.pitch}`;
        return true;
    }

    function resetLineSettings(index) {
        if (!isSpokenLine(index)) return false;
        lineSettings.delete(index);
        const button = settingsButtons.get(index);
        if (button) updateSettingsButton(button, index);
        status.textContent = `ជួរទី ${index + 1}៖ ប្រើល្បឿន និង pitch គោល ឬ Tag`;
        return true;
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
        const mirrorRect = mirror.getBoundingClientRect();
        const paddingTop = parseFloat(style.paddingTop);
        const paddingLeft = parseFloat(style.paddingLeft);
        const positions = new Map();
        const endPositions = new Map();
        const topFromRect = rect => paddingTop + rect.top - mirrorRect.top + (rect.height - BUTTON_HEIGHT) / 2;
        function positionOf(index) {
            if (positions.has(index)) return positions.get(index);
            const start = starts[index];
            const codePoint = previousValue.codePointAt(start);
            range.setStart(mirror.firstChild, start);
            range.setEnd(mirror.firstChild, start + (codePoint > 0xffff ? 2 : 1));
            const top = topFromRect(range.getBoundingClientRect());
            positions.set(index, top);
            return top;
        }
        function endOf(index) {
            if (endPositions.has(index)) return endPositions.get(index);
            const end = starts[index] + lines[index].trimEnd().length;
            range.setStart(mirror.firstChild, end);
            range.setEnd(mirror.firstChild, end);
            let rect = range.getBoundingClientRect();
            let x = rect.left;
            // A few browsers do not return a caret rectangle at the end of text.
            if (!rect.height && end > starts[index]) {
                const last = previousValue.charCodeAt(end - 1);
                const size = last >= 0xdc00 && last <= 0xdfff ? 2 : 1;
                range.setStart(mirror.firstChild, end - size);
                range.setEnd(mirror.firstChild, end);
                rect = range.getBoundingClientRect();
                x = rect.right;
            }
            const top = rect.height ? topFromRect(rect) : positionOf(index);
            const edge = paddingLeft + x - mirrorRect.left;
            const desiredLeft = style.direction === 'rtl' ? edge - BUTTON_HEIGHT - 5 : edge + 5;
            const left = Math.max(paddingLeft, Math.min(editor.clientWidth - BUTTON_HEIGHT - 4, desiredLeft));
            const result = { top, left };
            endPositions.set(index, result);
            return result;
        }

        const visibleTop = editor.scrollTop;
        const visibleBottom = visibleTop + editor.clientHeight;
        let low = 0;
        let high = lines.length;
        // A wrapped line can begin above the viewport but end inside it.
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (endOf(middle).top + BUTTON_HEIGHT < visibleTop) low = middle + 1;
            else high = middle;
        }

        const visibleRows = new Set();
        const visibleSettings = new Set();
        for (let index = low; index < lines.length; index++) {
            const top = positionOf(index);
            if (top > visibleBottom) break;
            if (!isSpokenLine(index)) continue;
            if (top + BUTTON_HEIGHT >= visibleTop) {
                visibleRows.add(index);
                let row = rows.get(index);
                if (!row) {
                    row = createRow(index);
                    rows.set(index, row);
                    const next = Array.from(gutter.children).find(child => Number(child.dataset.line) > index);
                    gutter.insertBefore(row, next || null);
                } else updateRow(row, index);
                row.style.top = `${top - visibleTop}px`;
            }
            const end = endOf(index);
            if (settingsLayer && end.top + BUTTON_HEIGHT >= visibleTop && end.top <= visibleBottom) {
                visibleSettings.add(index);
                let button = settingsButtons.get(index);
                if (!button) {
                    button = createSettingsButton(index);
                    settingsButtons.set(index, button);
                    const next = Array.from(settingsLayer.children).find(child => Number(child.dataset.line) > index);
                    settingsLayer.insertBefore(button, next || null);
                } else updateSettingsButton(button, index);
                button.style.top = `${end.top - visibleTop}px`;
                button.style.left = `${end.left}px`;
            }
        }
        for (const [index, row] of rows) {
            if (!visibleRows.has(index)) {
                row.remove();
                rows.delete(index);
            }
        }
        for (const [index, button] of settingsButtons) {
            if (!visibleSettings.has(index)) {
                button.remove();
                settingsButtons.delete(index);
            }
        }
    }

    function resetVoices() {
        choices = new Map();
        for (const [index, row] of rows) updateRow(row, index);
        updateResetButton();
    }

    // Used on document replacement and Clear; voice-only reset is independent.
    function reset() {
        resetVoices();
        lineSettings = new Map();
        revision++;
        onDocumentChange?.();
        for (const [index, button] of settingsButtons) updateSettingsButton(button, index);
        status.textContent = '';
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
        const edit = choices.size || lineSettings.size ? selectionEdit(previousValue, nextValue, starts, beforeInput) : null;
        choices = replacedAll ? new Map() : reconcileLineVoices(lines, nextLines, choices, edit);
        lineSettings = replacedAll ? new Map() : reconcileLineVoices(lines, nextLines, lineSettings, edit);
        const changed = nextValue !== previousValue;
        if (changed) revision++;
        beforeInput = null;
        previousValue = nextValue;
        lines = nextLines;
        starts = lineStarts(lines);
        // Old buttons must not target stale line numbers before the next paint.
        for (const row of rows.values()) row.remove();
        rows.clear();
        for (const button of settingsButtons.values()) button.remove();
        settingsButtons.clear();
        if (changed) onDocumentChange?.();
        updateResetButton();
        scheduleRender();
    });
    editor.addEventListener('scroll', scheduleRender, { passive: true });
    resetButton.addEventListener('click', () => {
        resetVoices();
        status.textContent = 'ប្រើសំឡេងគោល ឬ Tag សម្រាប់គ្រប់ជួរ';
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleRender).observe(editor);
    window.addEventListener('resize', scheduleRender);
    document.fonts?.addEventListener('loadingdone', scheduleRender);
    updateResetButton();
    scheduleRender();

    return {
        getChoices: () => new Map(choices),
        getSettings: () => new Map(Array.from(lineSettings, ([index, value]) => [index, { ...value }])),
        getRevision: () => revision,
        setLineSettings,
        resetLineSettings,
        reset,
    };
}
