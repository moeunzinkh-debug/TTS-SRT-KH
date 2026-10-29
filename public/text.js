// Remove SRT cue numbers and timing lines before splitting by voice tags.
// Only a number immediately followed by a timing line is treated as a cue ID,
// so ordinary text containing numbers is preserved.
const TIMING_LINE = /^\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}(?:\s+.*)?\s*$/;

export function stripSrtMetadata(value) {
    const lines = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    return lines.filter((line, index) => {
        if (TIMING_LINE.test(line)) return false;
        return !(/^\s*\d+\s*$/.test(line) && TIMING_LINE.test(lines[index + 1] || ''));
    }).join('\n');
}

// SRT timing is intentionally discarded: this application concatenates the
// dialogue rather than inserting silence to synchronize it with a video.
export function splitDialogue(value) {
    return stripSrtMetadata(value)
        .split(/\n\s*\n+/)
        .map(block => block.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
        .filter(Boolean);
}

export function buildVoiceParts(value, currentVoiceId, voiceConfigs, tagConfigs) {
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
