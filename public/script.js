import { buildVoiceParts } from './text.js';
import { createLineVoiceControls } from './line-voices.js';

let currentVoiceId = 'piseth';
let lineVoiceControls = null;
let audioObjectUrl = null;
let uploadSequence = 0;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const voiceConfigs = {
    piseth: { speed: 1.0, pitch: 0, voice: "km-KH-PisethNeural", name: "Piseth" },
    sreymom: { speed: 1.0, pitch: 0, voice: "km-KH-SreymomNeural", name: "Sreymom" }
};

// អូប៊ិចសម្រាប់គ្រប់គ្រង default tag configs
const tagConfigs = {
    piseth: { speed: 1.0, pitch: 0 },
    sreymom: { speed: 1.0, pitch: 0 }
};

// អថេរទុកចំណាំការ Highlight អត្ថបទពេលបើក Modal
let selectedRange = { start: 0, end: 0, text: "" };

let isAutoSpeedActive = false;

// --- Register Service Worker ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('✅ Service Worker បានចុះឈ្មោះជោគជ័យ', reg))
            .catch(err => console.log('❌ Service Worker ចុះឈ្មោះបរាជ័យ:', err));
    });
}

// --- Clear Cache Logic ---
window.clearAppCache = async () => {
    if (confirm("តើអ្នកប្រាកដជាចង់លុប Cache និងទាញយក Version ថ្មីឬ?")) {
        try {
            // ១. លុប Caches តាមរយៈ CacheStorage API
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
            }

            // ២. ប្រាប់ Service Worker ឱ្យលុប cache និង Unregister
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let registration of registrations) {
                    if (registration.active) {
                        registration.active.postMessage({ type: 'CLEAR_CACHE' });
                    }
                    await registration.unregister();
                }
            }

            alert("✅ Cache ត្រូវបានលុបជោគជ័យ! ទំព័រនឹងត្រូវ Reload ឥឡូវនេះ។");
            window.location.reload(true);
        } catch (error) {
            console.error("❌ បរាជ័យក្នុងការលុប Cache:", error);
            alert("⚠️ មានបញ្ហាក្នុងការលុប Cache! សូមព្យាយាមម្តងទៀត។");
        }
    }
};

// --- Theme Management ---
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        document.documentElement.classList.add('dark');
        updateThemeIcon(true);
    } else {
        document.documentElement.classList.remove('dark');
        updateThemeIcon(false);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    lineVoiceControls = createLineVoiceControls({
        editor: document.getElementById('editor'),
        gutter: document.getElementById('voice-line-gutter'),
        mirror: document.getElementById('voice-line-mirror'),
        resetButton: document.getElementById('line-voice-reset'),
        status: document.getElementById('line-voice-status'),
    });
});

window.toggleTheme = () => {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        updateThemeIcon(false);
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        updateThemeIcon(true);
    }
};

function updateThemeIcon(isDark) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
        lucide.createIcons();
    }
}

// --- Voice Selection UI ---
window.selectMainVoice = (vId) => {
    currentVoiceId = vId;
    
    const pisethCard = document.getElementById('card-piseth');
    const sreymomCard = document.getElementById('card-sreymom');
    
    if (vId === 'piseth') {
        pisethCard.classList.add('ring-2', 'ring-offset-2', 'ring-green-500', 'border-green-300');
        pisethCard.classList.remove('border-transparent');
        
        sreymomCard.classList.remove('ring-2', 'ring-offset-2', 'ring-pink-500', 'border-pink-300');
        sreymomCard.classList.add('border-transparent');
    } else {
        sreymomCard.classList.add('ring-2', 'ring-offset-2', 'ring-pink-500', 'border-pink-300');
        sreymomCard.classList.remove('border-transparent');
        
        pisethCard.classList.remove('ring-2', 'ring-offset-2', 'ring-green-500', 'border-green-300');
        pisethCard.classList.add('border-transparent');
    }
};

// --- បើក/បិទ Auto Speed ---
window.toggleAutoSpeed = () => {
    const btn = document.getElementById('auto-speed-btn');
    isAutoSpeedActive = !isAutoSpeedActive;
    if (isAutoSpeedActive) {
        btn.classList.add('bg-indigo-100', 'text-indigo-800', 'dark:bg-indigo-900', 'dark:text-indigo-200');
        document.getElementById('auto-speed-text').innerText = "Auto Speed: ON";
    } else {
        btn.classList.remove('bg-indigo-100', 'text-indigo-800', 'dark:bg-indigo-900', 'dark:text-indigo-200');
        document.getElementById('auto-speed-text').innerText = "Auto Speed: OFF";
    }
};

// --- បង្កើត Tag ធម្មតាសិន (ពេលចុច + Tag) ---
window.insertTag = (vId) => {
    const editor = document.getElementById('editor');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value;
    const selectedText = text.substring(start, end);
    
    const currentScrollPos = editor.scrollTop;
    
    // យកតម្លៃ Default Tag Config
    const currentSpeed = tagConfigs[vId] ? tagConfigs[vId].speed : 1.0;
    const currentPitch = tagConfigs[vId] ? tagConfigs[vId].pitch : 0;

    const tagName = vId;
    const attrString = ` speed="${currentSpeed}" pitch="${currentPitch}"`;
    let tagToInsert;
    let newCursorPos;

    if (selectedText.trim() === "") {
        tagToInsert = `<${tagName}${attrString}></${tagName}>`;
        newCursorPos = start + tagName.length + attrString.length + 2;
    } else {
        tagToInsert = `<${tagName}${attrString}>${selectedText}</${tagName}>`;
        newCursorPos = start + tagToInsert.length;
    }

    editor.focus();
    if (!document.execCommand('insertText', false, tagToInsert)) {
        editor.value = text.substring(0, start) + tagToInsert + text.substring(end);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    requestAnimationFrame(() => {
        editor.setSelectionRange(newCursorPos, newCursorPos);
        editor.scrollTop = currentScrollPos;
    });
};

// --- បើក Settings Modal សម្រាប់សំឡេងគោល ---
window.openSettings = (id, name) => {
    const s = voiceConfigs[id];
    document.getElementById('modal-title').innerText = name + " (សំឡេងគោល)";
    document.getElementById('input-speed').value = s.speed;
    document.getElementById('input-pitch').value = s.pitch;
    document.getElementById('target-id').value = 'main_' + id;
    
    updateVal('speed-val', s.speed + 'x');
    updateVal('pitch-val', s.pitch);
    document.getElementById('settings-modal').classList.remove('hidden');
};

// --- បើក Settings Modal សម្រាប់ Tag ---
window.openTagSettings = (id) => {
    const editor = document.getElementById('editor');
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const fullText = editor.value;
    
    selectedRange = {
        start: start,
        end: end,
        text: fullText.substring(start, end)
    };

    let defaultSpeed = tagConfigs[id] ? tagConfigs[id].speed : 1.0;
    let defaultPitch = tagConfigs[id] ? tagConfigs[id].pitch : 0;

    if (selectedRange.text.trim() !== "") {
        const speedMatch = selectedRange.text.match(/speed=["']([^"']+)["']/);
        const pitchMatch = selectedRange.text.match(/pitch=["']([^"']+)["']/);
        
        if (speedMatch) defaultSpeed = parseFloat(speedMatch[1]);
        if (pitchMatch) defaultPitch = parseInt(pitchMatch[1]);
    }

    const name = id === 'piseth' ? 'Piseth' : 'Sreymom';
    document.getElementById('modal-title').innerText = name + " (Tag Setting)";
    document.getElementById('input-speed').value = defaultSpeed;
    document.getElementById('input-pitch').value = defaultPitch;
    document.getElementById('target-id').value = 'tag_' + id;
    
    updateVal('speed-val', defaultSpeed + 'x');
    updateVal('pitch-val', defaultPitch);
    document.getElementById('settings-modal').classList.remove('hidden');
};

window.updateVal = (id, val) => {
    document.getElementById(id).innerText = val;
};

// --- រក្សាទុក Settings ---
window.saveSettings = () => {
    const id = document.getElementById('target-id').value;
    const sp = parseFloat(document.getElementById('input-speed').value);
    const pt = parseFloat(document.getElementById('input-pitch').value);

    if (id.startsWith('main_')) {
        const voiceId = id.replace('main_', '');
        voiceConfigs[voiceId].speed = sp;
        voiceConfigs[voiceId].pitch = pt;
        
        document.getElementById(`${voiceId}-speed`).innerText = sp + 'x';
        document.getElementById(`${voiceId}-pitch`).innerText = pt;
    } 
    else if (id.startsWith('tag_')) {
        const voiceId = id.replace('tag_', '');
        
        tagConfigs[voiceId].speed = sp;
        tagConfigs[voiceId].pitch = pt;
        document.getElementById(`${voiceId}-tag-speed`).innerText = sp + 'x';
        document.getElementById(`${voiceId}-tag-pitch`).innerText = pt;

        const editor = document.getElementById('editor');
        if (selectedRange.text.trim() !== "") {
            let tagText = selectedRange.text;
            
            if (/speed=["'][^"']+["']/.test(tagText)) {
                tagText = tagText.replace(/speed=["'][^"']+["']/, `speed="${sp}"`);
            } else {
                tagText = tagText.replace(/<(\w+)/, `<$1 speed="${sp}"`);
            }

            if (/pitch=["'][^"']+["']/.test(tagText)) {
                tagText = tagText.replace(/pitch=["'][^"']+["']/, `pitch="${pt}"`);
            } else {
                tagText = tagText.replace(/<(\w+)/, `<$1 pitch="${pt}"`);
            }

            const text = editor.value;
            editor.value = text.substring(0, selectedRange.start) + tagText + text.substring(selectedRange.end);
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    closeSettings();
};

window.closeSettings = () => {
    document.getElementById('settings-modal').classList.add('hidden');
};

// Read files locally; the text is only sent to the API when Generate is pressed.
window.uploadTextFile = async (event) => {
    const input = event.currentTarget || event.target;
    const file = input.files?.[0];
    // Reset immediately so the same file can be selected again.
    input.value = '';
    if (!file) return;
    const uploadId = ++uploadSequence;

    const isTextFile = /\.(srt|txt)$/i.test(file.name) ||
        ['text/plain', 'application/x-subrip'].includes(file.type.toLowerCase());
    if (!isTextFile) {
        alert('⚠️ សូមជ្រើសរើសឯកសារ SRT ឬ TXT។');
        return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        alert('⚠️ ឯកសារធំពេក។ ទំហំអតិបរមា 5 MB។');
        return;
    }

    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (uploadId !== uploadSequence) return;
        const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
            bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
        // Textarea values normalize line endings; compare in the same form when reselecting a file.
        const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
            .replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        if (text.includes('\0')) throw new Error('Invalid text file');
        if (!text.trim()) {
            alert('⚠️ ឯកសារនេះគ្មានអត្ថបទទេ។');
            return;
        }

        const editor = document.getElementById('editor');
        if (editor.value.trim() && editor.value !== text &&
            !confirm('តើអ្នកចង់ជំនួសអត្ថបទបច្ចុប្បន្នដោយឯកសារនេះឬ?')) return;
        if (editor.value !== text) lineVoiceControls?.reset();
        editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
    } catch (error) {
        if (uploadId !== uploadSequence) return;
        console.error('Error reading text file:', error);
        alert('⚠️ មិនអាចអានឯកសារបានទេ។ សូមប្រើ UTF-8 ឬ UTF-16 ដែលមាន BOM។');
    }
};

window.clearEditor = () => {
    if(confirm("តើលុបអត្ថបទទាំងអស់ជាក់លាក់ឬ?")) {
        uploadSequence++; // Do not let an earlier file read undo Clear.
        lineVoiceControls?.reset();
        const editor = document.getElementById('editor');
        editor.value = "";
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
};

// --- ផលិតសំឡេង (Main Function) ---
window.generateAudio = async () => {
    // Keep original line numbers (including leading blank lines) for voice choices.
    const textValue = document.getElementById('editor').value;
    if (!textValue.trim()) {
        alert("សូមបញ្ចូលអត្ថបទ SRT ឬអត្ថបទធម្មតា!");
        return;
    }

    const button = document.getElementById('convert-btn');
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    document.getElementById('loader').classList.remove('hidden');
    document.getElementById('audio-container').classList.add('hidden');

    const parts = buildVoiceParts(textValue, currentVoiceId, voiceConfigs, tagConfigs, lineVoiceControls?.getChoices());
    const formData = new FormData();
    formData.append('data', JSON.stringify(parts));
    formData.append('autoSpeed', isAutoSpeedActive);

    try {
        const response = await fetch('/api/process-multi', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(typeof body.detail === 'string'
                ? body.detail : 'មានបញ្ហាក្នុងការផលិតសំឡេង');
        }

        const blob = await response.blob();
        if (!blob.size) throw new Error('Edge TTS មិនបានបង្កើតសំឡេងទេ');
        if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
        audioObjectUrl = URL.createObjectURL(blob);

        const audioPlayer = document.getElementById('audio-player');
        const downloadLink = document.getElementById('download-link');
        audioPlayer.src = audioObjectUrl;
        downloadLink.href = audioObjectUrl;
        document.getElementById('audio-container').classList.remove('hidden');
        // Autoplay can be blocked; the user can still press Play.
        audioPlayer.play().catch(() => {});
    } catch (error) {
        console.error('Error generating audio:', error);
        alert('កើតមានកំហុស៖ ' + error.message);
    } finally {
        document.getElementById('loader').classList.add('hidden');
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
};