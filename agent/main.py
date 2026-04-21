"""FastAPI entry point for the Recon agent service."""

import os
import db
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Recon Agent", version="0.1.0")

_allowed_origins = ["http://localhost:3001", "http://localhost:3000"]
_app_url = os.getenv("NEXT_PUBLIC_APP_URL")
if _app_url:
    _allowed_origins.append(_app_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Agent control ────────────────────────────────────────────────────────────

@app.post("/agent/start")
async def agent_start():
    return {"status": "ok"}


@app.post("/agent/stop")
async def agent_stop():
    return {"status": "ok"}


@app.get("/agent/status")
async def agent_status():
    return {"status": "ok"}


@app.websocket("/agent/stream")
async def agent_stream(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"status": "ok"})
    await websocket.close()


# ── Job queue ────────────────────────────────────────────────────────────────

@app.post("/jobs/approve/{job_id}")
async def jobs_approve(job_id: str):
    await db.update_job_status(job_id, "approved")
    return {"status": "ok", "job_id": job_id}


@app.post("/jobs/skip/{job_id}")
async def jobs_skip(job_id: str):
    await db.update_job_status(job_id, "skipped")
    return {"status": "ok", "job_id": job_id}


@app.get("/jobs/queue")
async def jobs_queue():
    jobs = await db.get_pending_jobs()
    return {"jobs": jobs}


# ── LinkedIn outreach ────────────────────────────────────────────────────────

@app.post("/linkedin/approve")
async def linkedin_approve():
    return {"status": "ok"}


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
