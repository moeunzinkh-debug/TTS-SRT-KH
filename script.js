let currentVoiceId = 'piseth';
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
        }
    }

    closeSettings();
};

window.closeSettings = () => {
    document.getElementById('settings-modal').classList.add('hidden');
};

window.clearEditor = () => {
    if(confirm("តើលុបអត្ថបទទាំងអស់ជាក់លាក់ឬ?")) {
        document.getElementById('editor').value = "";
    }
};

// --- ផលិតសំឡេង (Main Function) ---
window.generateAudio = async () => {
    const textValue = document.getElementById('editor').value.trim();
    if (!textValue) {
        alert("សូមបញ្ចូលអត្ថបទ SRT ឬអត្ថបទធម្មតា!");
        return;
    }

    document.getElementById('loader').classList.remove('hidden');
    document.getElementById('audio-container').classList.add('hidden');

    const parts = [];
    const tagRegex = /<(\w+)(?:[^>]*?speed=["']([^"']+)["'])?(?:[^>]*?pitch=["']([^"']+)["'])?[^>]*?>(.*?)<\/\1>/gs;
    let lastIndex = 0;
    let match;
    
    while ((match = tagRegex.exec(textValue)) !== null) {
        const beforeText = textValue.substring(lastIndex, match.index).trim();
        if (beforeText) {
            parts.push({
                text: beforeText,
                voiceName: currentVoiceId,
                speed: voiceConfigs[currentVoiceId].speed,
                pitch: voiceConfigs[currentVoiceId].pitch
            });
        }
        
        const tagName = match[1];
        const attrSpeed = match[2] ? parseFloat(match[2]) : (tagConfigs[tagName] ? tagConfigs[tagName].speed : 1.0);
        const attrPitch = match[3] ? parseInt(match[3]) : (tagConfigs[tagName] ? tagConfigs[tagName].pitch : 0);
        const tagText = match[4].trim();

        if (tagText) {
            parts.push({
                text: tagText,
                voiceName: tagName,
                speed: attrSpeed,
                pitch: attrPitch
            });
        }
        
        lastIndex = tagRegex.lastIndex;
    }

    const remainingText = textValue.substring(lastIndex).trim();
    if (remainingText) {
        parts.push({
            text: remainingText,
            voiceName: currentVoiceId,
            speed: voiceConfigs[currentVoiceId].speed,
            pitch: voiceConfigs[currentVoiceId].pitch
        });
    }

    const formData = new FormData();
    formData.append('data', JSON.stringify(parts));
    formData.append('autoSpeed', isAutoSpeedActive);

    try {
        const response = await fetch('/api/process-multi', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('មានបញ្ហាក្នុងការផលិតសំឡេង');
        }

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        
        const audioPlayer = document.getElementById('audio-player');
        const downloadLink = document.getElementById('download-link');
        
        audioPlayer.src = audioUrl;
        downloadLink.href = audioUrl;
        
        document.getElementById('loader').classList.add('hidden');
        document.getElementById('audio-container').classList.remove('hidden');
        audioPlayer.play();
    } catch (error) {
        console.error('Error generating audio:', error);
        alert('កើតមានកំហុស៖ ' + error.message);
        document.getElementById('loader').classList.add('hidden');
    }
};