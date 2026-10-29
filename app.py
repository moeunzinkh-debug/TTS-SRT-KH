"""Optional FastAPI version of the same API used by the Cloudflare Worker."""
import asyncio
import json
import logging
import math
import re
from pathlib import Path

import edge_tts
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

app = FastAPI()
logger = logging.getLogger(__name__)

VOICE_MAP = {
    "piseth": "km-KH-PisethNeural",
    "sreymom": "km-KH-SreymomNeural",
    "visal": "km-KH-PisethNeural",
    "mina": "km-KH-SreymomNeural",
}
MAX_FORM_BYTES = 256 * 1024
MAX_TEXT_CHARACTERS = 20000
MAX_PARTS = 200
MAX_SYNTHESIS_REQUESTS = 40
MAX_ESCAPED_BYTES = 3500
MAX_TOTAL_AUDIO_BYTES = 32 * 1024 * 1024
TIMING_LINE = re.compile(
    r"^\s*(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*"
    r"(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3}(?:\s+.*)?\s*$"
)


def parse_srt(value):
    """Extract dialogue from SRT or plain text without speaking cue metadata."""
    lines = value.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    retained = []
    for index, line in enumerate(lines):
        if TIMING_LINE.match(line):
            continue
        if re.fullmatch(r"\s*\d+\s*", line) and index + 1 < len(lines) and TIMING_LINE.match(lines[index + 1]):
            continue
        retained.append(line)
    return [
        " ".join(line.strip() for line in block.split("\n") if line.strip())
        for block in re.split(r"\n\s*\n+", "\n".join(retained))
        if block.strip()
    ]


def escaped_bytes(char):
    if char == "&":
        return 5
    if char in "<>":
        return 4
    if char in "\"'":
        return 6
    return len(char.encode("utf-8"))


def split_text(text, limit=MAX_ESCAPED_BYTES):
    """Split by escaped UTF-8 length without splitting Unicode code points."""
    chunks = []
    start = 0
    while start < len(text):
        end, byte_count, last_space = start, 0, -1
        while end < len(text) and byte_count + escaped_bytes(text[end]) <= limit:
            byte_count += escaped_bytes(text[end])
            if text[end].isspace():
                last_space = end + 1
            end += 1
        if end == start:
            raise HTTPException(400, "Text contains a character that is too large.")
        if end < len(text) and last_space > start:
            end = last_space
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end
    return chunks


def number(value, default, label):
    if value is ...:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float, str)) or (isinstance(value, str) and not value.strip()):
        raise HTTPException(400, f"{label} must be a number.")
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise HTTPException(400, f"{label} must be a number.") from None
    if not math.isfinite(result):
        raise HTTPException(400, f"{label} must be a number.")
    return result


def signed(value, unit):
    return f"{value:+d}{unit}"


def prepare_segments(parts, auto_speed=False):
    if not isinstance(parts, list) or not parts:
        raise HTTPException(400, "Please provide at least one text part.")
    if len(parts) > MAX_PARTS:
        raise HTTPException(413, f"At most {MAX_PARTS} voice parts are allowed.")
    tasks = []
    total = 0
    for part in parts:
        if not isinstance(part, dict) or not isinstance(part.get("text"), str):
            raise HTTPException(400, "Each part must contain text.")
        raw_text = part["text"]
        total += len(raw_text)
        if total > MAX_TEXT_CHARACTERS:
            raise HTTPException(413, f"Text exceeds the {MAX_TEXT_CHARACTERS}-character limit.")
        if not raw_text.strip():
            continue
        voice_name = part.get("voiceName", "piseth")
        if not isinstance(voice_name, str) or voice_name not in VOICE_MAP:
            raise HTTPException(400, "Unknown voice. Choose Piseth or Sreymom.")
        speed = number(part.get("speed", ...), 1, "Speed")
        pitch = number(part.get("pitch", ...), 0, "Pitch")
        part_auto_speed = part.get("autoSpeed", auto_speed)
        if not isinstance(part_auto_speed, bool):
            raise HTTPException(400, "Per-part autoSpeed must be true or false.")
        if not 0.5 <= speed <= 2:
            raise HTTPException(400, "Speed must be between 0.5 and 2.0.")
        if pitch != int(pitch) or not -10 <= pitch <= 10:
            raise HTTPException(400, "Pitch must be a whole number between -10 and 10.")

        for dialogue in parse_srt(raw_text):
            text = re.sub(r"</?[A-Za-z][^>]*>", "", dialogue)
            text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ud800-\udfff\ufffe\uffff]", " ", text).strip()
            if not text:
                continue
            final_speed = (1.4 if len(text) > 45 else 1.2 if len(text) > 30 else 1) if part_auto_speed and speed == 1 else speed
            # Match JavaScript Math.round for custom fractional speed values.
            rate = signed(math.floor((final_speed - 1) * 100 + 0.5), "%")
            pitch_hz = signed(int(pitch) * 20, "Hz")
            for piece in split_text(text):
                byte_count = sum(escaped_bytes(char) for char in piece)
                previous = tasks[-1] if tasks else None
                if previous and previous["voice"] == VOICE_MAP[voice_name] and previous["rate"] == rate and previous["pitch"] == pitch_hz and previous["bytes"] + 1 + byte_count <= MAX_ESCAPED_BYTES:
                    previous["text"] += "\n" + piece
                    previous["bytes"] += 1 + byte_count
                else:
                    tasks.append({"text": piece, "voice": VOICE_MAP[voice_name], "rate": rate, "pitch": pitch_hz, "bytes": byte_count})
                    if len(tasks) > MAX_SYNTHESIS_REQUESTS:
                        raise HTTPException(413, f"Too many voice changes or text segments (maximum {MAX_SYNTHESIS_REQUESTS}).")
    if not tasks:
        raise HTTPException(400, "No text to synthesize.")
    return tasks


async def synthesize(segment):
    communicate = edge_tts.Communicate(segment["text"], segment["voice"], rate=segment["rate"], pitch=segment["pitch"])
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
            if len(audio) > MAX_TOTAL_AUDIO_BYTES:
                raise ValueError("audio is too large")
    if not audio:
        raise ValueError("no audio returned")
    return bytes(audio)


@app.post("/api/process-multi")
async def process_multi(request: Request):
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        raise HTTPException(400, "Invalid Content-Length.") from None
    if content_length > MAX_FORM_BYTES:
        raise HTTPException(413, "Request is too large.")
    # Enforce the limit even for chunked requests without Content-Length.
    body = bytearray()
    try:
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_FORM_BYTES:
                raise HTTPException(413, "Request is too large.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Could not read request body.") from None

    async def receive_body():
        return {"type": "http.request", "body": bytes(body), "more_body": False}

    try:
        form = await Request(request.scope, receive_body).form()
    except Exception:
        raise HTTPException(400, "Send a multipart form containing data.") from None
    raw = form.get("data")
    if not isinstance(raw, str) or not raw:
        raise HTTPException(400, "No data provided.")
    if len(raw.encode("utf-8")) > MAX_FORM_BYTES:
        raise HTTPException(413, "Request is too large.")
    try:
        parts = json.loads(raw)
    except (ValueError, TypeError):
        raise HTTPException(400, "Data must be a valid JSON array.") from None
    auto_speed = form.get("autoSpeed", "false")
    if auto_speed not in ("true", "false"):
        raise HTTPException(400, "autoSpeed must be true or false.")
    segments = prepare_segments(parts, auto_speed == "true")
    audio = bytearray()
    for segment in segments:
        try:
            chunk = await asyncio.wait_for(synthesize(segment), timeout=60)
        except asyncio.TimeoutError:
            raise HTTPException(504, "Edge TTS timed out. Please try again.") from None
        except Exception as error:
            logger.warning("Edge TTS synthesis failed: %s", type(error).__name__)
            raise HTTPException(502, "Could not generate Edge TTS audio. Check the network and try again.") from None
        if not chunk:
            raise HTTPException(502, "Edge TTS returned no audio.")
        audio.extend(chunk)
        if len(audio) > MAX_TOTAL_AUDIO_BYTES:
            raise HTTPException(502, "Edge TTS audio is too large.")
    return Response(bytes(audio), media_type="audio/mpeg", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


app.mount("/", StaticFiles(directory=Path(__file__).resolve().parent / "public", html=True), name="public")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
