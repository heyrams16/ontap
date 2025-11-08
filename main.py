import os
import uuid
import time
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx
import asyncio

load_dotenv()

UPSTREAM_API_BASE = os.getenv("UPSTREAM_API_BASE", "").strip()
UPSTREAM_API_KEY = os.getenv("UPSTREAM_API_KEY", "").strip()
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",") if o.strip()]

app = FastAPI(title="OnTap SPU HackSPU Demo API (v2)", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------
# In-memory mock store
# -------------------------------
STORE: Dict[str, Any] = {
    "users": {},
    "teams": {},
    "gigs": [],
    "mentors": [
        {"id": "m1", "name": "Prof. Cinelli", "skills": ["Design Thinking", "Product"], "slots": ["10:00", "11:00", "13:00"]},
        {"id": "m2", "name": "Prof. Andrew", "skills": ["Finance", "Valuation"], "slots": ["10:30", "12:30", "14:00"]},
        {"id": "m3", "name": "Alumni Mentor", "skills": ["AI/ML", "Deploy"], "slots": ["11:30", "13:30"]},
    ],
    "checkins": [],
    "points": {},
    "broadcasts": [],
    "scores": []  # list of {team_id, judge, category, score, ts}
}

# -------------------------------
# WebSocket manager
# -------------------------------
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        try:
            self.active.remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, message: Dict[str, Any]):
        dead = []
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

async def broadcast_leaderboard():
    lb = await leaderboard()
    await manager.broadcast({"type": "leaderboard", "data": lb})

# -------------------------------
# Models
# -------------------------------
class LoginBody(BaseModel):
    email: str

class CreateTeamBody(BaseModel):
    team_name: str

class JoinTeamBody(BaseModel):
    team_id: str

class GigBody(BaseModel):
    title: str
    description: str
    reward_points: int = 10

class MentorBookBody(BaseModel):
    mentor_id: str
    slot: str
    team_id: str

class CheckinBody(BaseModel):
    team_id: str
    code: Optional[str] = None

class AwardBody(BaseModel):
    team_id: str
    points: int
    reason: str

class BroadcastBody(BaseModel):
    message: str

class JudgeScoreBody(BaseModel):
    team_id: str
    judge: str
    category: str
    score: int  # 0-10

# -------------------------------
# Helper: optional upstream proxy
# -------------------------------
async def proxy_if_configured(path: str, method: str = "GET", json: Any = None, params: Dict[str,str] = None):
    if not UPSTREAM_API_BASE:
        return None  # proxy disabled
    url = f"{UPSTREAM_API_BASE.rstrip('/')}/{path.lstrip('/')}"
    headers = {}
    if UPSTREAM_API_KEY:
        headers["Authorization"] = f"Bearer {UPSTREAM_API_KEY}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.request(method, url, headers=headers, json=json, params=params)
        resp.raise_for_status()
        return resp.json()

# -------------------------------
# WebSocket endpoint
# -------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # On connect, push current leaderboard immediately
    try:
        await broadcast_leaderboard()
        while True:
            # We don't require client messages; just keep alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# -------------------------------
# Auth
# -------------------------------
@app.post("/api/auth/login")
async def login(body: LoginBody):
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email required")
    user_id = STORE["users"].get(email) or str(uuid.uuid4())
    STORE["users"][email] = user_id
    return {"user_id": user_id, "email": email}

# -------------------------------
# Teams
# -------------------------------
@app.post("/api/teams/create")
async def create_team(body: CreateTeamBody):
    r = await proxy_if_configured("/teams/create", "POST", json=body.dict())
    if r is not None:
        return r
    team_id = str(uuid.uuid4())
    STORE["teams"][team_id] = {
        "id": team_id,
        "name": body.team_name,
        "members": [],
        "created_at": int(time.time())
    }
    await broadcast_leaderboard()
    return STORE["teams"][team_id]

@app.post("/api/teams/join")
async def join_team(body: JoinTeamBody):
    team = STORE["teams"].get(body.team_id)
    if not team:
        raise HTTPException(status_code=404, detail="team not found")
    team["members"].append(f"member-{len(team['members'])+1}")
    return {"ok": True, "team": team}

@app.get("/api/teams")
async def list_teams():
    return list(STORE["teams"].values())

# -------------------------------
# Gigs
# -------------------------------
@app.get("/api/gigs")
async def list_gigs():
    r = await proxy_if_configured("/gigs", "GET")
    if r is not None:
        return r
    return STORE["gigs"]

@app.post("/api/gigs")
async def add_gig(body: GigBody):
    r = await proxy_if_configured("/gigs", "POST", json=body.dict())
    if r is not None:
        return r
    gig = {**body.dict(), "id": str(uuid.uuid4()), "created_at": int(time.time())}
    STORE["gigs"].append(gig)
    return gig

# -------------------------------
# Mentors
# -------------------------------
@app.get("/api/mentors")
async def list_mentors():
    return STORE["mentors"]

@app.post("/api/mentors/book")
async def book_mentor(body: MentorBookBody):
    r = await proxy_if_configured("/mentors/book", "POST", json=body.dict())
    if r is not None:
        return r
    return {"ok": True, "booking_id": str(uuid.uuid4()), **body.dict()}

# -------------------------------
# Check-in & Points
# -------------------------------
@app.post("/api/checkin")
async def checkin(body: CheckinBody):
    rec = {"id": str(uuid.uuid4()), "team_id": body.team_id, "code": body.code or "HACKSPU2025", "ts": int(time.time())}
    STORE["checkins"].append(rec)
    # auto-award small points
    STORE["points"][body.team_id] = STORE["points"].get(body.team_id, 0) + 5
    await broadcast_leaderboard()
    return {"ok": True, **rec}

@app.post("/api/points/award")
async def award_points(body: AwardBody):
    STORE["points"][body.team_id] = STORE["points"].get(body.team_id, 0) + body.points
    await broadcast_leaderboard()
    return {"ok": True, "team_id": body.team_id, "total_points": STORE["points"][body.team_id]}

@app.get("/api/leaderboard")
async def leaderboard():
    lb = []
    for tid, team in STORE["teams"].items():
        lb.append({
            "team_id": tid,
            "team_name": team["name"],
            "points": STORE["points"].get(tid, 0)
        })
    lb.sort(key=lambda x: x["points"], reverse=True)
    return lb

# -------------------------------
# Broadcasts
# -------------------------------
@app.get("/api/broadcasts")
async def broadcasts():
    return STORE["broadcasts"]

@app.post("/api/broadcasts")
async def create_broadcast(body: BroadcastBody):
    msg = {"id": str(uuid.uuid4()), "message": body.message, "ts": int(time.time())}
    STORE["broadcasts"].append(msg)
    return msg

# -------------------------------
# Judging
# -------------------------------
@app.post("/api/judging/score")
async def judge_score(body: JudgeScoreBody):
    if body.score < 0 or body.score > 10:
        raise HTTPException(status_code=400, detail="score must be 0-10")
    if body.team_id not in STORE["teams"]:
        raise HTTPException(status_code=404, detail="team not found")
    rec = {"team_id": body.team_id, "judge": body.judge, "category": body.category, "score": body.score, "ts": int(time.time())}
    STORE["scores"].append(rec)
    # demo behavior: score adds to points 1:1
    STORE["points"][body.team_id] = STORE["points"].get(body.team_id, 0) + body.score
    await broadcast_leaderboard()
    return {"ok": True, **rec}

@app.get("/api/judging/summary")
async def judge_summary():
    # returns {team_id: {"avg": float, "count": int, "by_category": {cat: avg}}}
    out: Dict[str, Any] = {}
    for s in STORE["scores"]:
        tid = s["team_id"]
        out.setdefault(tid, {"avg": 0.0, "count": 0, "sum": 0.0, "by_category": {}})
        out[tid]["sum"] += s["score"]
        out[tid]["count"] += 1
        bc = out[tid]["by_category"]
        bc.setdefault(s["category"], {"sum": 0.0, "count": 0})
        bc[s["category"]]["sum"] += s["score"]
        bc[s["category"]]["count"] += 1
    # finalize avgs
    for tid, v in out.items():
        v["avg"] = (v["sum"] / v["count"]) if v["count"] else 0.0
        v.pop("sum", None)
        for cat, c in v["by_category"].items():
            c["avg"] = (c["sum"] / c["count"]) if c["count"] else 0.0
            c.pop("sum", None)
    return out

# -------------------------------
# Health
# -------------------------------
@app.get("/health")
async def health():
    return {"ok": True, "service": "ontap-hackspu-demo", "version": "2.0"}
