import asyncio
import edge_tts
import re
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import io
import os
import uuid
import json
from pydub import AudioSegment
import traceback

# --- កំណត់ FFmpeg ---
AudioSegment.converter = "/usr/bin/ffmpeg"
AudioSegment.ffprobe   = "/usr/bin/ffprobe"

app = FastAPI()

# Folder សម្រាប់ទុកឯកសារ
OUTPUT_DIR = "output_audio"
os.makedirs(OUTPUT_DIR, exist_ok=True)

VOICE_MAP = {
    "piseth": "km-KH-PisethNeural",
    "sreymom": "km-KH-SreymomNeural",
    "mina": "km-KH-SreymomNeural",
    "visal": "km-KH-PisethNeural"
}

def parse_srt(srt_text):
    """
    ស្ទាក់ស្ទើរ SRT ឯកសារ ដោះស្រាយ dialogues
    """
    blocks = re.split(r'\n\s*\n', srt_text.strip())
    dialogues = []
    
    for block in blocks:
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        if len(lines) >= 2:
            if "-->" in lines[1]:
                content = " ".join(lines[2:]).strip()
                if content:
                    dialogues.append(content)
            else:
                dialogues.append(" ".join(lines))
        elif len(lines) == 1:
            dialogues.append(lines[0])
            
    return dialogues

@app.post("/api/process-multi")
async def process_multi(request: Request):
    try:
        form = await request.form()
        parts_data = form.get('data')
        is_auto_speed_on = form.get('autoSpeed') == 'true'
        
        if not parts_data:
            raise HTTPException(status_code=400, detail="No data provided")
            
        parts = json.loads(parts_data)
        combined_audio = AudioSegment.empty()

        for part in parts:
            raw_text = part.get('text', '').strip()
            if not raw_text: 
                continue

            text_segments = parse_srt(raw_text)

            ui_speed = float(part.get('speed', 1.0))
            ui_pitch = int(part.get('pitch', 0))

            for text_content in text_segments:
                if is_auto_speed_on and ui_speed == 1.0:
                    char_count = len(text_content)
                    if char_count > 45:
                        final_speed = 1.4
                    elif char_count > 30:
                        final_speed = 1.2
                    else:
                        final_speed = 1.0
                else:
                    final_speed = ui_speed
                
                final_pitch = ui_pitch

                rate_param = f"{(final_speed - 1.0) * 100:+.0f}%"
                pitch_param = f"{final_pitch * 20:+.0f}Hz"

                clean_text = re.sub(r'<[^>]+>', '', text_content).strip()
                if not clean_text:
                    continue

                current_voice = VOICE_MAP.get(part.get('voiceName', 'piseth'), "km-KH-PisethNeural")

                try:
                    communicate = edge_tts.Communicate(clean_text, current_voice, rate=rate_param, pitch=pitch_param)
                    data = b""
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio": 
                            data += chunk["data"]
                    if data:
                        combined_audio += AudioSegment.from_file(io.BytesIO(data), format="mp3")
                except Exception as e:
                    print(f"❌ Edge TTS Error: {e}")
                    traceback.print_exc()

        if len(combined_audio) > 0:
            final_path = os.path.join(OUTPUT_DIR, f"final_{uuid.uuid4()}.mp3")
            combined_audio.export(final_path, format="mp3")
            print(f"✅ ឯកសារចុងក្រោយ: {final_path}")
            return FileResponse(final_path, media_type="audio/mpeg")
        else:
            raise HTTPException(status_code=400, detail="No audio generated")

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ General Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

app.mount("/", StaticFiles(directory="public", html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)