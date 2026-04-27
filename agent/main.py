"""FastAPI entry point for the Recon agent service."""

import asyncio
import base64
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import db
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from browser.application_agent import run_application_batch
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from outreach import email_sender, recruiter_scraper
from outreach.linkedin_queue import queue_connection_request, queue_inmail
from scheduler.scheduler import get_scheduler, get_job_statuses, trigger_job_now

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = get_scheduler(broadcast_fn=broadcast)
    scheduler.start()
    print("[main] APScheduler started")
    yield
    scheduler.shutdown(wait=False)
    print("[main] APScheduler stopped")


app = FastAPI(title="Recon Agent", version="0.1.0", lifespan=lifespan)

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
_agent_last_run_at: str | None = None
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
    global _agent_last_run_at, _agent_status
    had_error = False
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
        had_error = True
        _agent_status = "error"
        await broadcast({"type": "action", "message": f"Agent error: {str(e)}"})
        await broadcast({"type": "status", "status": "error"})
    finally:
        _agent_last_run_at = datetime.now(timezone.utc).isoformat()
        if not had_error:
            _agent_status = "idle"
            await broadcast({"type": "status", "status": "idle"})


async def _get_job_for_outreach(job_id: str) -> dict | None:
    """Fetch one job plus any attached application resume metadata."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT
            j.id,
            j.title,
            j.company,
            j.location,
            j.jobBoardUrl,
            j.source,
            j.status,
            j.isTopPriority,
            j.jdText,
            j.matchScore,
            a.id AS applicationId,
            a.resumeVersion,
            a.coverLetter
        FROM Job j
        LEFT JOIN Application a ON a.jobId = j.id
        WHERE j.id = ?
        LIMIT 1
        """,
        [job_id],
    )
    if not result.rows:
        return None
    columns = [c.name for c in result.columns]
    return dict(zip(columns, result.rows[0]))


def _build_connection_note(
    first_name: str,
    job_title: str,
    company: str,
) -> str:
    note = (
        f"Hi {first_name}, I just applied to {job_title} at {company} and "
        f"wanted to connect. I'm a CS + Finance sophomore at ASU (4.0 GPA), "
        f"interning at Wells Fargo this summer. Would love to stay in touch! "
        f"— Amaan"
    )
    return note[:300]


def _build_inmail_message(
    first_name: str,
    job_title: str,
    company: str,
) -> str:
    subject = f"{job_title} Application — Amaan Sayed (ASU, 4.0 GPA)"
    body = (
        f"Hi {first_name}, I applied to {job_title} at {company} and wanted "
        f"to reach out directly. I'm a CS + Finance sophomore at ASU Barrett "
        f"Honors (4.0 GPA), joining Wells Fargo as a SWE Intern this summer. "
        f"I've built RaftPay (distributed Go system, 7663 TPS) and ARTEMIS "
        f"(RAG pipeline, 500+ users). Would you be open to a quick 15-minute "
        f"call? — Amaan Sayed | asayed7@asu.edu"
    )
    return f"Subject: {subject}\n\n{body}"


def _recruiter_relevance(recruiter: dict) -> int:
    score = recruiter.get("relevanceScore")
    if score is None:
        score = recruiter.get("relevance_score")
    return int(score or 0)


async def _get_pending_jobs_payload() -> list[dict]:
    """Return pending jobs with the full fields expected by dashboard UIs."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT id, title, company, location, jobBoardUrl, source,
               status, isTopPriority, jdText, matchScore, createdAt
        FROM Job
        WHERE status = 'pending'
        ORDER BY isTopPriority DESC, createdAt ASC
        """
    )
    columns = [c.name for c in result.columns]
    return [dict(zip(columns, row)) for row in result.rows]


async def _get_dashboard_stats() -> dict:
    """Return aggregate stats for the dashboard overview page."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM Job WHERE status = 'pending') AS pending,
            (SELECT COUNT(*) FROM Application
             WHERE status = 'submitted') AS submitted,
            (SELECT COUNT(*) FROM RecruiterOutreach
             WHERE sentAt IS NOT NULL
               AND sentAt >= datetime('now', 'localtime', 'start of day'))
                AS outreachToday,
            (SELECT COUNT(*) FROM Job
             WHERE status IN ('approved', 'applied')) AS activePipeline
        """
    )
    row = result.rows[0] if result.rows else (0, 0, 0, 0)
    return {
        "pending": int(row[0]),
        "submitted": int(row[1]),
        "outreachToday": int(row[2]),
        "activePipeline": int(row[3]),
    }


async def _get_recent_applications(limit: int = 10) -> list[dict]:
    """Return recent applications joined with job metadata for dashboards."""
    client = db.get_client()
    result = await client.execute(
        """
        SELECT
            a.id,
            a.status,
            a.portalEmail,
            a.resumeVersion,
            a.createdAt,
            a.submittedAt,
            j.title AS jobTitle,
            j.company AS jobCompany,
            j.location AS jobLocation,
            j.source AS jobSource,
            j.jobBoardUrl,
            j.isTopPriority
        FROM Application a
        JOIN Job j ON j.id = a.jobId
        ORDER BY COALESCE(a.submittedAt, a.createdAt) DESC
        LIMIT ?
        """,
        [limit],
    )
    applications = []
    for row in result.rows:
        applications.append({
            "id": row[0],
            "status": row[1],
            "portalEmail": row[2],
            "resumeVersion": row[3],
            "createdAt": row[4],
            "submittedAt": row[5],
            "job": {
                "title": row[6],
                "company": row[7],
                "location": row[8],
                "source": row[9],
                "jobBoardUrl": row[10],
                "isTopPriority": bool(row[11]),
            },
        })
    return applications


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
    return {
        "status": _agent_status,
        "log": _action_log[-20:],
        "lastRunAt": _agent_last_run_at,
    }


@app.get("/candidate")
async def candidate_profile():
    return await db.get_candidate_profile()


@app.patch("/candidate")
async def update_candidate_profile(request: Request):
    body = await request.json()
    return await db.update_candidate_profile(body)


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
    response = {
        "status": "ok",
        "job_id": job_id,
        "outreach_queued": False,
        "recruiter_name": None,
        "linkedin_connection_queued": False,
        "linkedin_inmail_queued": False,
        "email_attempted": False,
        "email_sent": False,
    }

    job = await _get_job_for_outreach(job_id)
    if not job:
        print(f"[main] warning: approved job {job_id} not found for outreach")
        return response

    company = (job.get("company") or "").strip()
    job_title = (job.get("title") or "Software Engineering Intern").strip()
    resume_pdf_path = job.get("resumeVersion") or ""
    if not company:
        print(f"[main] warning: approved job {job_id} is missing company")
        return response

    try:
        recruiters = await db.get_recruiters_for_company(company)
        if not recruiters:
            recruiter_ids = await recruiter_scraper.find_and_store_recruiters(company)
            if recruiter_ids:
                recruiters = await db.get_recruiters_for_company(company)

        recruiters = sorted(
            recruiters,
            key=_recruiter_relevance,
            reverse=True,
        )
        if not recruiters:
            print(
                f"[main] warning: no recruiters found for {company} after "
                f"approving job {job_id}"
            )
            return response

        recruiter = recruiters[0]
        recruiter_id = recruiter.get("id")
        recruiter_name = recruiter.get("name") or ""
        recruiter_email = recruiter.get("email") or ""
        first_name = recruiter_name.split()[0] if recruiter_name else "there"

        response["recruiter_name"] = recruiter_name or None

        if not recruiter_id:
            print(
                f"[main] warning: top recruiter missing id for {company} on "
                f"job {job_id}"
            )
            return response

        try:
            connection_note = _build_connection_note(first_name, job_title, company)
            outreach_id = await db.queue_outreach(
                recruiter_id=recruiter_id,
                channel="linkedin_connection",
                application_id=None,
                message_text=connection_note,
            )
            response["linkedin_connection_queued"] = bool(outreach_id)
        except Exception as e:
            print(
                f"[main] warning: failed to queue LinkedIn connection for "
                f"{recruiter_name}: {e}"
            )

        try:
            inmail_text = _build_inmail_message(first_name, job_title, company)
            outreach_id = await db.queue_outreach(
                recruiter_id=recruiter_id,
                channel="linkedin_inmail",
                application_id=None,
                message_text=inmail_text,
            )
            response["linkedin_inmail_queued"] = bool(outreach_id)
        except Exception as e:
            print(
                f"[main] warning: failed to queue LinkedIn InMail for "
                f"{recruiter_name}: {e}"
            )

        if recruiter_email and "@" in recruiter_email:
            response["email_attempted"] = True
            try:
                response["email_sent"] = await email_sender.send_recruiter_email(
                    recruiter_id=recruiter_id,
                    recruiter_name=recruiter_name,
                    recruiter_email=recruiter_email,
                    company=company,
                    role=job_title,
                    resume_pdf_path=resume_pdf_path,
                    application_id=None,
                )
            except Exception as e:
                print(
                    f"[main] warning: failed to send recruiter email for "
                    f"{recruiter_name}: {e}"
                )
        else:
            print(
                f"[main] warning: recruiter email missing for {recruiter_name} "
                f"at {company}; skipping email"
            )

        response["outreach_queued"] = any(
            (
                response["linkedin_connection_queued"],
                response["linkedin_inmail_queued"],
                response["email_attempted"],
            )
        )
    except Exception as e:
        print(f"[main] warning: outreach trigger failed for job {job_id}: {e}")

    return response


@app.post("/jobs/skip/{job_id}")
async def jobs_skip(job_id: str):
    await db.update_job_status(job_id, "skipped")
    return {"status": "ok", "job_id": job_id}


@app.get("/jobs/queue")
async def jobs_queue():
    jobs = await _get_pending_jobs_payload()
    return {"jobs": jobs}


@app.get("/dashboard/stats")
async def dashboard_stats():
    return await _get_dashboard_stats()


@app.get("/applications/recent")
async def recent_applications():
    applications = await _get_recent_applications(limit=10)
    return {"applications": applications}


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
    recruiter_ids = await recruiter_scraper.find_and_store_recruiters(company)
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

    success = await email_sender.send_recruiter_email(
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


# ── Scheduler status ─────────────────────────────────────────────────────────

@app.post("/scheduler/trigger/{job_id}")
async def scheduler_trigger(job_id: str):
    triggered = await trigger_job_now(job_id)
    if not triggered:
        return JSONResponse(
            status_code=404,
            content={"status": "error", "message": "Unknown job_id"},
        )
    return {"status": "ok", "job_id": job_id, "triggered": True}


@app.get("/scheduler/status")
async def scheduler_status():
    return {"jobs": get_job_statuses()}


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}
