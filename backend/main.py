"""
Standup – FastAPI + Socket.IO + Next.js proxy backend
Run: python backend/main.py
Access: http://localhost:8000
"""

import os, uuid, logging, random, string, httpx
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import socketio

from .nlp_engine import TranscriptEntry, summarize_meeting, MeetingSummary

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("standup")

# ─────────────────────────────────────────────────────────────
# Room state
# ─────────────────────────────────────────────────────────────
class Room:
    def __init__(self, code: str):
        self.code = code
        self.created_at = datetime.utcnow()
        self.participants: Dict[str, dict] = {}
        self.messages: List[dict] = []
        self.transcript: List[dict] = []
        self.started_at: Optional[datetime] = None
        self.ended_at: Optional[datetime] = None
        self.summary: Optional[dict] = None

    def add_participant(self, sid: str, info: dict):
        if not self.started_at:
            self.started_at = datetime.utcnow()
        self.participants[sid] = info

    def remove_participant(self, sid: str):
        return self.participants.pop(sid, None)

    def duration_minutes(self) -> float:
        if not self.started_at:
            return 0.0
        end = self.ended_at or datetime.utcnow()
        return (end - self.started_at).total_seconds() / 60

    def to_dict(self):
        return {
            "code": self.code,
            "participant_count": len(self.participants),
            "participants": list(self.participants.values()),
            "duration_minutes": round(self.duration_minutes(), 1),
        }


rooms: Dict[str, Room] = {}
sid_to_room: Dict[str, str] = {}

# ─────────────────────────────────────────────────────────────
# Socket.IO
# ─────────────────────────────────────────────────────────────
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
)


@sio.event
async def connect(sid, environ):
    logger.info(f"connect: {sid}")


@sio.event
async def disconnect(sid):
    logger.info(f"disconnect: {sid}")
    await _leave(sid)


@sio.event
async def join_room(sid, data: dict):
    code = data.get("code", "").lower().strip()
    name = (data.get("name", "Guest") or "Guest")[:40]

    if not code:
        await sio.emit("error", {"message": "Invalid room code"}, to=sid)
        return

    if code not in rooms:
        rooms[code] = Room(code=code)

    room = rooms[code]
    participant = {
        "sid": sid, "name": name,
        "joined_at": datetime.utcnow().isoformat(),
        "is_host": len(room.participants) == 0,
        "audio": True, "video": True, "screen": False, "hand_raised": False,
    }
    room.add_participant(sid, participant)
    sid_to_room[sid] = code
    await sio.enter_room(sid, code)

    existing = [p for p in room.participants.values() if p["sid"] != sid]
    await sio.emit("room_joined", {
        "code": code, "your_sid": sid,
        "participants": existing,
        "messages": room.messages[-100:],
        "transcript": room.transcript[-200:],
    }, to=sid)

    await sio.emit("participant_joined", participant, room=code, skip_sid=sid)
    logger.info(f"{name} joined {code} ({len(room.participants)} total)")


@sio.event
async def leave_room(sid, data=None):
    await _leave(sid)


# WebRTC signaling – just forward
@sio.event
async def webrtc_offer(sid, data: dict):
    if t := data.get("target"):
        await sio.emit("webrtc_offer", {"offer": data.get("offer"), "from": sid}, to=t)

@sio.event
async def webrtc_answer(sid, data: dict):
    if t := data.get("target"):
        await sio.emit("webrtc_answer", {"answer": data.get("answer"), "from": sid}, to=t)

@sio.event
async def webrtc_ice_candidate(sid, data: dict):
    if t := data.get("target"):
        await sio.emit("webrtc_ice_candidate", {"candidate": data.get("candidate"), "from": sid}, to=t)


@sio.event
async def send_message(sid, data: dict):
    code = sid_to_room.get(sid)
    if not code or code not in rooms:
        return
    room = rooms[code]
    p = room.participants.get(sid, {})
    msg = {
        "id": str(uuid.uuid4()),
        "text": (data.get("text", "") or "")[:2000],
        "sender_sid": sid,
        "sender_name": p.get("name", "Guest"),
        "timestamp": datetime.utcnow().isoformat(),
    }
    room.messages.append(msg)
    await sio.emit("new_message", msg, room=code)


@sio.event
async def transcript_entry(sid, data: dict):
    code = sid_to_room.get(sid)
    if not code or code not in rooms:
        return
    room = rooms[code]
    p = room.participants.get(sid, {})
    entry = {
        "id": str(uuid.uuid4()),
        "speaker": p.get("name", "Guest"),
        "speaker_sid": sid,
        "text": (data.get("text", "") or "")[:2000],
        "timestamp": data.get("timestamp", 0),
        "created_at": datetime.utcnow().isoformat(),
    }
    room.transcript.append(entry)
    await sio.emit("transcript_update", entry, room=code)


@sio.event
async def media_state(sid, data: dict):
    code = sid_to_room.get(sid)
    if not code or code not in rooms:
        return
    room = rooms[code]
    if sid in room.participants:
        for k in ("audio", "video", "screen"):
            if k in data:
                room.participants[sid][k] = data[k]
    await sio.emit("participant_media_state", {"sid": sid, **data}, room=code, skip_sid=sid)


@sio.event
async def raise_hand(sid, data: dict):
    code = sid_to_room.get(sid)
    if not code:
        return
    room = rooms.get(code)
    raised = bool(data.get("raised", False))
    if room and sid in room.participants:
        room.participants[sid]["hand_raised"] = raised
    await sio.emit("hand_raised", {"sid": sid, "raised": raised}, room=code)


@sio.event
async def reaction(sid, data: dict):
    code = sid_to_room.get(sid)
    if not code:
        return
    room = rooms.get(code)
    p = room.participants.get(sid, {}) if room else {}
    await sio.emit("participant_reaction", {
        "sid": sid, "name": p.get("name", ""),
        "emoji": data.get("emoji", "👍"),
    }, room=code)


@sio.event
async def request_summary(sid, data=None):
    code = sid_to_room.get(sid)
    if not code or code not in rooms:
        await sio.emit("summary_result", {"error": "Room not found"}, to=sid)
        return
    room = rooms[code]
    result = _generate_summary(room)
    room.summary = result
    await sio.emit("summary_result", result, room=code)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
async def _leave(sid: str):
    code = sid_to_room.pop(sid, None)
    if not code or code not in rooms:
        return
    room = rooms[code]
    p = room.remove_participant(sid)
    await sio.leave_room(sid, code)
    if p:
        await sio.emit("participant_left", {"sid": sid, "name": p.get("name")}, room=code)
        logger.info(f"{p.get('name')} left {code}")
    if not room.participants:
        room.ended_at = datetime.utcnow()
        logger.info(f"Room {code} empty")


def _generate_summary(room: Room) -> dict:
    if not room.transcript:
        return {"error": "No transcript available. Add transcript entries during the meeting."}

    entries = [
        TranscriptEntry(speaker=e["speaker"], text=e["text"], timestamp=e.get("timestamp", 0))
        for e in room.transcript if (e.get("text") or "").strip()
    ]

    if not entries:
        return {"error": "Transcript is empty"}

    result: MeetingSummary = summarize_meeting(
        transcript=entries,
        duration_minutes=room.duration_minutes(),
        title=f"Meeting {room.code.upper()}",
        num_summary_sentences=6,
    )

    return {
        "title": result.title,
        "duration_minutes": round(result.duration_minutes, 1),
        "participant_count": result.participant_count,
        "summary_sentences": result.summary_sentences,
        "action_items": result.action_items,
        "decisions": result.decisions,
        "key_topics": result.key_topics,
        "sentiment": result.sentiment,
        "sentiment_score": result.sentiment_score,
        "highlights": result.meeting_highlights,
        "speaker_stats": result.speaker_stats,
        "word_cloud_terms": result.word_cloud_terms,
        "questions_raised": result.questions_raised,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _gen_code() -> str:
    c = string.ascii_lowercase
    return f"{''.join(random.choices(c,k=3))}-{''.join(random.choices(c,k=4))}-{''.join(random.choices(c,k=3))}"


# ─────────────────────────────────────────────────────────────
# FastAPI
# ─────────────────────────────────────────────────────────────
app = FastAPI(title="Standup")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

NEXT_PORT = int(os.environ.get("NEXT_PORT", "3000"))
# NEXT_HOST = os.environ.get("NEXT_HOST", "localhost")
# NEXT_URL  = f"http://{NEXT_HOST}:{NEXT_PORT}"
NEXT_URL = os.environ.get("NEXT_URL", "http://localhost:3000")

# REST API routes
@app.post("/api/rooms")
async def create_room():
    return {"code": _gen_code()}

@app.get("/api/rooms/{code}")
async def get_room(code: str):
    room = rooms.get(code.lower())
    if not room:
        return JSONResponse({"exists": False, "code": code})
    return JSONResponse({"exists": True, **room.to_dict()})

@app.get("/api/rooms/{code}/summary")
async def get_summary(code: str):
    room = rooms.get(code.lower())
    if not room:
        raise HTTPException(404, "Room not found")
    return room.summary or _generate_summary(room)

@app.get("/api/health")
async def health():
    return {"status": "ok", "rooms": len(rooms)}

@app.get("/")
async def root():
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(NEXT_URL)
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=dict(resp.headers),
        )


# Proxy everything else to Next.js
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_to_nextjs(request: Request, path: str):
    url = f"{NEXT_URL}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    headers = dict(request.headers)
    headers.pop("host", None)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            body = await request.body()
            resp = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
                follow_redirects=True,
            )
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=dict(resp.headers),
            )
    except httpx.ConnectError:
        return Response(
            content=b"<h1>Frontend not running</h1><p>Start Next.js: <code>cd frontend && npm run dev</code></p>",
            status_code=502,
            media_type="text/html",
        )


# ─────────────────────────────────────────────────────────────
# Combined ASGI
# ─────────────────────────────────────────────────────────────
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="/socket.io")


if __name__ == "__main__":
    import uvicorn, subprocess, sys, time, threading

    # Start Next.js dev server in background
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
    frontend_dir = os.path.abspath(frontend_dir)

    logger.info(f"Starting Next.js on port {NEXT_PORT}...")
    next_proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "-p", str(NEXT_PORT)],
        cwd=frontend_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Give Next.js a moment to start
    time.sleep(2)

    def cleanup():
        next_proc.terminate()

    import atexit
    atexit.register(cleanup)

    logger.info("Starting Standup on http://0.0.0.0:8000")
    uvicorn.run(socket_app, host="0.0.0.0", port=8000, log_level="info")
