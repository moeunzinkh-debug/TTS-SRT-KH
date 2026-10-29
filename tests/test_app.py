import asyncio
import json

import edge_tts.constants
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app


client = TestClient(app.app)


def form(parts, auto_speed="false"):
    return {"data": json.dumps(parts, ensure_ascii=False), "autoSpeed": auto_speed}


def part(text, **overrides):
    return {"text": text, "voiceName": "piseth", "speed": 1, "pitch": 0, **overrides}


def test_up_to_date_edge_tts_uses_v2():
    assert edge_tts.constants.SEC_MS_GEC_VERSION.startswith("2-")


def test_parse_srt_and_batch_cues():
    srt = "\ufeff1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>សួស្តី</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nពិភពលោក"
    assert app.parse_srt(srt) == ["<i>សួស្តី</i>", "ពិភពលោក"]
    tasks = app.prepare_segments([part(srt)])
    assert len(tasks) == 1
    assert tasks[0]["text"] == "សួស្តី\nពិភពលោក"
    assert tasks[0]["voice"] == "km-KH-PisethNeural"
    assert app.parse_srt("There are\n42\npeople.") == ["There are 42 people."]


def test_settings_auto_speed_and_utf8_splitting():
    tasks = app.prepare_segments([
        part("ខ" * 31, voiceName="mina"),
        part("ខ" * 46, voiceName="visal"),
        part("manual", voiceName="sreymom", speed=0.8, pitch=-2),
    ], auto_speed=True)
    assert [(item["voice"], item["rate"], item["pitch"]) for item in tasks] == [
        ("km-KH-SreymomNeural", "+20%", "+0Hz"),
        ("km-KH-PisethNeural", "+40%", "+0Hz"),
        ("km-KH-SreymomNeural", "-20%", "-40Hz"),
    ]
    text = "ខ&🙂'\"" * 1500
    chunks = app.split_text(text)
    assert len(chunks) > 1
    assert "".join(chunks) == text
    assert all(sum(app.escaped_bytes(char) for char in chunk) <= app.MAX_ESCAPED_BYTES for chunk in chunks)


@pytest.mark.parametrize("parts", [
    [], {}, [{"text": 1}], [part("hello", voiceName="unknown")],
    [part("hello", speed=None)], [part("hello", speed=2.1)],
    [part("hello", pitch=1.5)], [part("hello", pitch=11)], [part(" ")],
])
def test_invalid_inputs_are_rejected(parts):
    with pytest.raises(HTTPException) as error:
        app.prepare_segments(parts)
    assert error.value.status_code == 400


def test_request_limits():
    with pytest.raises(HTTPException) as error:
        app.prepare_segments([part("x" * 20001)])
    assert error.value.status_code == 413
    many = [part("hello", voiceName="sreymom" if index % 2 else "piseth") for index in range(41)]
    with pytest.raises(HTTPException) as error:
        app.prepare_segments(many)
    assert error.value.status_code == 413


def test_synthesize_uses_current_edge_tts_and_filters_metadata(monkeypatch):
    captured = {}

    class Communicate:
        def __init__(self, text, voice, **options):
            captured.update(text=text, voice=voice, **options)

        async def stream(self):
            yield {"type": "WordBoundary", "data": b"ignored"}
            yield {"type": "audio", "data": b"\xff\xf3"}
            yield {"type": "audio", "data": b"\x01\x02"}

    monkeypatch.setattr(app.edge_tts, "Communicate", Communicate)
    task = app.prepare_segments([part("សួស្តី", voiceName="sreymom", speed=1.2, pitch=-2)])[0]
    assert asyncio.run(app.synthesize(task)) == b"\xff\xf3\x01\x02"
    assert captured == {"text": "សួស្តី", "voice": "km-KH-SreymomNeural", "rate": "+20%", "pitch": "-40Hz"}


def test_api_returns_ordered_audio_without_files(monkeypatch):
    calls = []

    async def fake_synthesize(task):
        calls.append(task)
        return bytes([0xff, len(calls)])

    monkeypatch.setattr(app, "synthesize", fake_synthesize)
    response = client.post("/api/process-multi", data=form([
        part("សួស្តី"), part("friend", voiceName="sreymom", speed=1.2, pitch=2),
    ]))
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"\xff\x01\xff\x02"
    assert [(task["voice"], task["rate"], task["pitch"]) for task in calls] == [
        ("km-KH-PisethNeural", "+0%", "+0Hz"), ("km-KH-SreymomNeural", "+20%", "+40Hz"),
    ]


def test_api_validation_failure_and_no_partial_audio(monkeypatch):
    assert client.post("/api/process-multi", data={}).status_code == 400
    assert client.post("/api/process-multi", data={"data": "{broken"}).status_code == 400
    assert client.post("/api/process-multi", data=form([part("hello")], "maybe")).status_code == 400
    assert client.post("/api/process-multi", data=form([part("hello", pitch=None)])).status_code == 400
    chunked = client.post(
        "/api/process-multi",
        content=(chunk for chunk in [b"data=", b"x" * 270000]),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert chunked.status_code == 413

    calls = 0

    async def failing_synthesize(_task):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("upstream failed")
        return b"audio"

    monkeypatch.setattr(app, "synthesize", failing_synthesize)
    response = client.post("/api/process-multi", data=form([part("first"), part("second", voiceName="sreymom")]))
    assert response.status_code == 502
    assert response.json()["detail"].startswith("Could not generate")

    async def timeout(_task):
        raise asyncio.TimeoutError

    monkeypatch.setattr(app, "synthesize", timeout)
    assert client.post("/api/process-multi", data=form([part("first")])).status_code == 504


def test_static_files_work_from_repository_root():
    assert "SRT Smart Voice Studio" in client.get("/").text
    assert client.get("/script.js").status_code == 200
    assert client.get("/text.js").status_code == 200
    assert client.get("/app.py").status_code == 404


def test_per_part_auto_speed_overrides_global_without_changing_older_requests():
    long_text = 'ខ' * 46
    tasks = app.prepare_segments([
        part(long_text), part(long_text, autoSpeed=False, pitch=2), part(long_text, autoSpeed=True, pitch=-2),
    ], auto_speed=True)
    assert [(task['rate'], task['pitch']) for task in tasks] == [
        ('+40%', '+0Hz'), ('+0%', '+40Hz'), ('+40%', '-40Hz'),
    ]
    assert app.prepare_segments([part(long_text, autoSpeed=True)], auto_speed=False)[0]['rate'] == '+40%'
    assert app.prepare_segments([part(long_text)], auto_speed=False)[0]['rate'] == '+0%'
    for value in ('false', None, 0, 1):
        with pytest.raises(HTTPException):
            app.prepare_segments([part(long_text, autoSpeed=value)])


def test_api_passes_per_line_auto_speed_override(monkeypatch):
    seen = []

    async def fake_synthesize(task):
        seen.append(task)
        return b'audio'

    monkeypatch.setattr(app, 'synthesize', fake_synthesize)
    long_text = 'ខ' * 46
    response = client.post('/api/process-multi', data=form([
        part(long_text, autoSpeed=False), part(long_text, pitch=1),
    ], 'true'))
    assert response.status_code == 200
    assert [(item['rate'], item['pitch']) for item in seen] == [('+0%', '+0Hz'), ('+40%', '+20Hz')]
