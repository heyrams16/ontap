# HackSPU × OnTap SPU — Live Demo Bundle (v2)

New in v2:
- ✅ **QR generation** on the frontend for team check-ins
- ✅ **Judge scoring screen** (submit scores by category; auto-applies to points)
- ✅ **WebSocket live updates** for leaderboard

## Quick Start
### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 5050
```
### Frontend
```bash
# serve (recommended)
cd frontend
python -m http.server 8080
# open http://localhost:8080
```
Change API target in `frontend/config.js`.

## WebSocket
Frontend connects to `${API_BASE.replace('http','ws')}/ws` and updates leaderboard in real time when points/check-ins/judge scores change.

## Judge Scoring (Demo)
- Tab **Judging** lets a judge pick a team, category, and score (0–10).
- Each score immediately **adds to points** for that team (simple demo behavior) and updates the leaderboard live.
- Summary endpoint exposes per-team averages.
