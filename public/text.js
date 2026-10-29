// Remove SRT cue numbers and timing lines before splitting by voice tags.
// Only a number immediately followed by a timing line is treated as a cue ID,
// so ordinary text containing numbers is preserved.
const TIMING_LINE = /^\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}(?:\s+.*)?\s*$/;

// The same rules are used by the editor's per-line controls and synthesis.
export function isSrtMetadata(lines, index) {
    const line = index === 0 ? (lines[index] || '').replace(/^\uFEFF/, '') : (lines[index] || '');
    return TIMING_LINE.test(line) ||
        (/^\s*\d+\s*$/.test(line) && TIMING_LINE.test(lines[index + 1] || ''));
}

export function hasSpokenText(line) {
    return !!line.replace(/^\uFEFF/, '').replace(/<\/?[A-Za-z][^>]*>/g, '').trim();
}

export function stripSrtMetadata(value) {
    const lines = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    return lines.filter((line, index) => !isSrtMetadata(lines, index)).join('\n');
}

// SRT timing is intentionally discarded: this application concatenates the
// dialogue rather than inserting silence to synchronize it with a video.
export function splitDialogue(value) {
    return stripSrtMetadata(value)
        .split(/\n\s*\n+/)
        .map(block => block.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
        .filter(Boolean);
}

export function buildVoiceParts(value, currentVoiceId, voiceConfigs, tagConfigs, lineVoices, lineSettings, autoSpeed = false) {
    if (lineVoices?.size || lineSettings?.size) {
        return buildLineVoiceParts(value, currentVoiceId, voiceConfigs, tagConfigs, lineVoices, lineSettings, autoSpeed);
    }
    const text = stripSrtMetadata(value);
    const parts = [];
    const voiceTag = /<(piseth|sreymom|mina|visal)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    const main = voiceConfigs[currentVoiceId];
    let lastIndex = 0;
    let match;

    const append = (partText, voiceName, speed, pitch) => {
        if (partText.trim()) parts.push({ text: partText.trim(), voiceName, speed, pitch });
    };

    while ((match = voiceTag.exec(text)) !== null) {
        append(text.slice(lastIndex, match.index), currentVoiceId, main.speed, main.pitch);
        const name = match[1].toLowerCase();
        const defaults = tagConfigs[name] || { speed: 1, pitch: 0 };
        const speed = /\bspeed\s*=\s*(["'])(.*?)\1/i.exec(match[2]);
        const pitch = /\bpitch\s*=\s*(["'])(.*?)\1/i.exec(match[2]);
        append(match[3], name, speed ? Number(speed[2]) : defaults.speed,
            pitch ? Number(pitch[2]) : defaults.pitch);
        lastIndex = voiceTag.lastIndex;
    }

    append(text.slice(lastIndex), currentVoiceId, main.speed, main.pitch);
    return parts;
}

// Apply line-level voice and prosody without changing the user's text. Existing
// inline tags continue to work on lines without an override, even across lines.
// SRT metadata is never assigned a voice.
function buildLineVoiceParts(value, currentVoiceId, voiceConfigs, tagConfigs, lineVoices, lineSettings, autoSpeed, observe) {
    const source = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const retained = [];
    let offset = 0;
    for (let index = 0; index < source.length; index++) {
        if (isSrtMetadata(source, index)) continue;
        retained.push({ index, start: offset, text: source[index] });
        offset += source[index].length + 1;
    }
    const text = retained.map(line => line.text).join('\n');
    const parts = [];
    const main = voiceConfigs[currentVoiceId];

    const lineAt = position => {
        let low = 0;
        let high = retained.length;
        while (low + 1 < high) {
            const middle = Math.floor((low + high) / 2);
            if (retained[middle].start <= position) low = middle;
            else high = middle;
        }
        return low;
    };

    const append = (chunk, voiceName, speed, pitch, autoSpeedOverride) => {
        if (!chunk) return;
        const previous = parts[parts.length - 1];
        // Keep separators without creating empty parts or needless voice changes.
        if (!chunk.trim()) {
            if (previous) previous.text += chunk;
        } else if (previous && previous.voiceName === voiceName && previous.speed === speed &&
            previous.pitch === pitch && previous.autoSpeed === autoSpeedOverride) {
            previous.text += chunk;
        } else {
            const part = { text: chunk, voiceName, speed, pitch };
            if (autoSpeedOverride !== undefined) part.autoSpeed = autoSpeedOverride;
            parts.push(part);
        }
    };

    const appendRun = (run, start, voiceName, speed, pitch) => {
        if (!run) return;
        let line = lineAt(start);
        let position = 0;
        while (position < run.length) {
            const newline = run.indexOf('\n', position);
            const end = newline < 0 ? run.length : newline + 1;
            const sourceIndex = retained[line].index;
            const selected = lineVoices?.get(sourceIndex);
            const selectedConfig = voiceConfigs[selected];
            const baseVoice = selectedConfig ? selected : voiceName;
            const baseSpeed = selectedConfig ? selectedConfig.speed : speed;
            const basePitch = selectedConfig ? selectedConfig.pitch : pitch;
            const chunk = run.slice(position, end);
            observe?.(sourceIndex, chunk, { voiceName: baseVoice, speed: baseSpeed, pitch: basePitch });
            const custom = lineSettings?.get(sourceIndex);
            // Explicit line settings must not be changed by global Auto Speed.
            append(chunk, baseVoice, custom?.speed ?? baseSpeed, custom?.pitch ?? basePitch,
                custom && autoSpeed ? false : undefined);
            position = end;
            if (newline >= 0) line++;
        }
    };

    const voiceTag = /<(piseth|sreymom|mina|visal)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    let lastIndex = 0;
    let match;
    while ((match = voiceTag.exec(text)) !== null) {
        appendRun(text.slice(lastIndex, match.index), lastIndex, currentVoiceId, main.speed, main.pitch);
        const name = match[1].toLowerCase();
        const defaults = tagConfigs[name] || { speed: 1, pitch: 0 };
        const speed = /\bspeed\s*=\s*(["'])(.*?)\1/i.exec(match[2]);
        const pitch = /\bpitch\s*=\s*(["'])(.*?)\1/i.exec(match[2]);
        const contentStart = match.index + match[0].indexOf('>') + 1;
        appendRun(match[3], contentStart, name, speed ? Number(speed[2]) : defaults.speed,
            pitch ? Number(pitch[2]) : defaults.pitch);
        lastIndex = voiceTag.lastIndex;
    }
    appendRun(text.slice(lastIndex), lastIndex, currentVoiceId, main.speed, main.pitch);
    return parts.map(part => ({ ...part, text: part.text.trim() })).filter(part => part.text);
}

// Show the first spoken segment's inherited values when opening a line's
// settings. Existing line choices take precedence over inline voice tags.
export function getLineInheritedSettings(value, lineIndex, currentVoiceId, voiceConfigs, tagConfigs, lineVoices) {
    const selected = lineVoices?.get(lineIndex);
    const fallback = voiceConfigs[selected] || voiceConfigs[currentVoiceId] || { speed: 1, pitch: 0 };
    let inherited;
    if (!voiceConfigs[selected] && value.includes('<')) {
        buildLineVoiceParts(value, currentVoiceId, voiceConfigs, tagConfigs, lineVoices, undefined, false,
            (index, chunk, settings) => {
                if (!inherited && index === lineIndex && hasSpokenText(chunk)) inherited = settings;
            });
    }
    const candidate = inherited || fallback;
    return {
        speed: Number.isFinite(candidate.speed) && candidate.speed >= 0.5 && candidate.speed <= 2
            ? candidate.speed : fallback.speed,
        pitch: Number.isInteger(candidate.pitch) && candidate.pitch >= -10 && candidate.pitch <= 10
            ? candidate.pitch : fallback.pitch,
    };
}
