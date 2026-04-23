"""FastAPI entry point for the Recon agent service."""

import asyncio
import base64
import os
import db
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from browser.application_agent import run_application_batch
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from outreach.recruiter_scraper import find_and_store_recruiters
from outreach.email_sender import send_recruiter_email
from outreach.linkedin_queue import queue_connection_request, queue_inmail

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

# Agent state
_agent_status = "idle"   # idle | running | error
_active_websockets: list[WebSocket] = []
_action_log: list[dict] = []   # last 50 actions


async def broadcast(message: dict) -> None:
    """Broadcast a message to all connected WebSocket clients."""
    global _action_log
    if message.get("type") in ("action", "status", "complete"):
        _action_log.append(message)
        if len(_action_log) > 50:
            _action_log.pop(0)
    dead = []
    for ws in _active_websockets:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _active_websockets.remove(ws)


async def _run_batch_background():
    global _agent_status
    try:
        approved_jobs = await db.get_approved_jobs()
        if not approved_jobs:
            await broadcast({"type": "action", "message": "No approved jobs found"})
            _agent_status = "idle"
            await broadcast({"type": "status", "status": "idle"})
            return

        def screenshot_cb(jpeg_bytes: bytes):
            data = base64.b64encode(jpeg_bytes).decode()
            asyncio.create_task(broadcast({
                "type": "screenshot",
                "data": data,
            }))

        results = await run_application_batch(
            approved_jobs,
            screenshot_callback=screenshot_cb,
        )
        applied = sum(1 for r in results if r.success)
        failed = sum(1 for r in results if not r.success)

        await broadcast({
            "type": "complete",
            "applied": applied,
            "failed": failed,
        })
        await broadcast({
            "type": "action",
            "message": f"Batch complete — {applied} applied, {failed} failed",
        })
    except Exception as e:
        await broadcast({"type": "action", "message": f"Agent error: {str(e)}"})
    finally:
        _agent_status = "idle"
        await broadcast({"type": "status", "status": "idle"})


# ── Agent control ────────────────────────────────────────────────────────────

@app.post("/agent/start")
async def agent_start():
    global _agent_status
    _agent_status = "running"
    await broadcast({"type": "status", "status": "running"})
    await broadcast({"type": "action",
                     "message": "Agent started — fetching approved jobs"})
    asyncio.create_task(_run_batch_background())
    return {"status": "ok"}


@app.post("/agent/stop")
async def agent_stop():
    global _agent_status
    _agent_status = "idle"
    await broadcast({"type": "status", "status": "idle"})
    return {"status": "ok"}


@app.get("/agent/status")
async def agent_status():
    return {"status": _agent_status, "log": _action_log[-20:]}


@app.websocket("/agent/stream")
async def agent_stream(websocket: WebSocket):
    await websocket.accept()
    _active_websockets.append(websocket)
    await websocket.send_json({
        "type": "status",
        "status": _agent_status,
    })
    for entry in _action_log[-20:]:
        await websocket.send_json(entry)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in _active_websockets:
            _active_websockets.remove(websocket)


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


# ── Application batch ────────────────────────────────────────────────────────

@app.post("/agent/run-batch")
async def run_batch():
    """Fetch all approved jobs and run application batch."""
    approved_jobs = await db.get_approved_jobs()
    if not approved_jobs:
        return {"status": "ok", "message": "No approved jobs"}
    results = await run_application_batch(approved_jobs)
    applied = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    return {
        "status": "ok",
        "applied": applied,
        "failed": failed,
        "results": [
            {"job_id": r.job_id, "status": r.status, "error": r.error}
            for r in results
        ],
    }


# ── Recruiter search ─────────────────────────────────────────────────────────

@app.post("/recruiters/find/{company}")
async def find_recruiters(company: str):
    """Trigger recruiter search for a company. Called after approving a job."""
    recruiter_ids = await find_and_store_recruiters(company)
    return {
        "status": "ok",
        "company": company,
        "recruiters_found": len(recruiter_ids),
        "recruiter_ids": recruiter_ids,
    }


@app.get("/recruiters/{company}")
async def get_recruiters(company: str):
    """Get all stored recruiters for a company."""
    recruiters = await db.get_recruiters_for_company(company)
    return {"status": "ok", "recruiters": recruiters}


# ── Outreach sequencer ───────────────────────────────────────────────────────

@app.post("/outreach/email/{recruiter_id}")
async def send_email_outreach(recruiter_id: str, body: dict):
    """Send email to a recruiter. Body: { company, role, resume_pdf_path,
    application_id? }"""
    recruiters = await db.get_recruiters_for_company(body.get("company", ""))
    recruiter = next((r for r in recruiters if r["id"] == recruiter_id), None)
    if not recruiter or not recruiter.get("email"):
        return {"status": "error", "message": "Recruiter or email not found"}

    success = await send_recruiter_email(
        recruiter_id=recruiter_id,
        recruiter_name=recruiter["name"],
        recruiter_email=recruiter["email"],
        company=recruiter["company"],
        role=body.get("role", "Software Engineering Intern"),
        resume_pdf_path=body.get("resume_pdf_path", ""),
        application_id=body.get("application_id"),
    )
    return {"status": "ok" if success else "error", "sent": success}


@app.post("/outreach/linkedin/queue/{recruiter_id}")
async def queue_linkedin_outreach(recruiter_id: str, body: dict):
    """Queue a LinkedIn connection request. Body: { company, role,
    recruiter_name, application_id? }"""
    outreach_id = await queue_connection_request(
        recruiter_id=recruiter_id,
        recruiter_name=body.get("recruiter_name", ""),
        company=body.get("company", ""),
        role=body.get("role", "Software Engineering Intern"),
        application_id=body.get("application_id"),
    )
    return {"status": "ok", "outreach_id": outreach_id}


@app.get("/outreach/queued")
async def get_queued_outreach():
    """Get all LinkedIn outreach items waiting for user approval."""
    queued = await db.get_queued_linkedin_outreach()
    return {"status": "ok", "items": queued}


@app.post("/outreach/send/{outreach_id}")
async def send_queued_outreach(outreach_id: str):
    """Mark a queued LinkedIn outreach as approved. Actual send happens via
    browser-use in a separate process."""
    client = db.get_client()
    await client.execute(
        "UPDATE RecruiterOutreach SET status='approved' WHERE id=?",
        [outreach_id],
    )
    return {"status": "ok", "outreach_id": outreach_id}


# ── LinkedIn outreach (legacy stub) ──────────────────────────────────────────

@app.post("/linkedin/approve")
async def linkedin_approve():
    return {"status": "ok"}


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
