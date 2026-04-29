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


def _split_env_urls(*values: str | None) -> list[str]:
    urls: list[str] = []
    for value in values:
        if not value:
            continue
        for part in value.split(","):
            url = part.strip().rstrip("/")
            if url and url not in urls:
                urls.append(url)
    return urls


_allowed_origins = _split_env_urls(
    "http://localhost:3001",
    "http://localhost:3000",
    os.getenv("NEXT_PUBLIC_APP_URL"),
    os.getenv("AUTH_URL"),
    os.getenv("CORS_ALLOW_ORIGINS"),
)

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


def _parse_db_datetime(value: str | None) -> datetime | None:
    """Parse DB timestamps into UTC-aware datetimes."""
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _get_ready_retry_jobs() -> list[dict]:
    """Return retry_queued jobs whose retry delay has elapsed."""
    retry_jobs = await db.get_retry_queued_jobs()
    ready_jobs = []
    now = datetime.now(timezone.utc)

    for job in retry_jobs:
        retry_count = int(job.get("retryCount") or 0)
        updated_at = _parse_db_datetime(job.get("updatedAt"))
        delay_seconds = db.get_retry_delay_seconds(retry_count)

        if updated_at is None:
            ready_jobs.append(job)
            continue

        elapsed_seconds = (now - updated_at).total_seconds()
        if elapsed_seconds >= delay_seconds:
            ready_jobs.append(job)

    return ready_jobs


async def _get_application_batch_jobs() -> tuple[list[dict], list[dict], list[dict]]:
    """Return approved jobs, ready retry jobs, and the combined batch list."""
    approved_jobs = await db.get_approved_jobs()
    retry_jobs = await _get_ready_retry_jobs()
    return approved_jobs, retry_jobs, [*approved_jobs, *retry_jobs]


async def _run_batch_background():
    global _agent_last_run_at, _agent_status
    had_error = False
    try:
        approved_jobs, retry_jobs, jobs_to_process = await _get_application_batch_jobs()
        if not jobs_to_process:
            await broadcast({
                "type": "action",
                "message": "No approved or due retry jobs found",
            })
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
            jobs_to_process,
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
            "message": (
                f"Batch complete — {applied} applied, {failed} failed"
                f" ({len(approved_jobs)} approved, {len(retry_jobs)} retries)"
            ),
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
    columns = [
        c.name if hasattr(c, "name") else str(c)
        for c in result.columns
    ]
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


async def _get_pending_jobs_payload(
    limit: int = 20,
    cursor: str | None = None,
) -> dict:
    """Return pending jobs with cursor pagination for dashboard UIs."""
    client = db.get_client()
    query = """
        SELECT id, title, company, location, jobBoardUrl, source,
               status, isTopPriority, useResumeTailor, runRecruiterSearch,
               jdText, matchScore, createdAt
        FROM Job
        WHERE status = 'pending'
    """
    params: list[object] = []
    if cursor is not None:
        cursor_result = await client.execute(
            """
            SELECT id, isTopPriority, createdAt
            FROM Job
            WHERE id = ?
            LIMIT 1
            """,
            [cursor],
        )
        if cursor_result.rows:
            cursor_id, cursor_priority, cursor_created_at = cursor_result.rows[0]
            query += """
              AND (
                isTopPriority < ?
                OR (
                  isTopPriority = ?
                  AND (
                    createdAt > ?
                    OR (createdAt = ? AND id > ?)
                  )
                )
              )
            """
            params.extend(
                [
                    int(cursor_priority or 0),
                    int(cursor_priority or 0),
                    cursor_created_at,
                    cursor_created_at,
                    cursor_id,
                ]
            )
    query += """
        ORDER BY isTopPriority DESC, createdAt ASC, id ASC
        LIMIT ?
        """
    params.append(limit + 1)
    result = await client.execute(query, params)
    columns = [
        c.name if hasattr(c, "name") else str(c)
        for c in result.columns
    ]
    jobs = [dict(zip(columns, row)) for row in result.rows]

    next_cursor = None
    if len(jobs) > limit:
        last_row = jobs.pop()
        next_cursor = last_row["id"]

    return {"jobs": jobs, "nextCursor": next_cursor}


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


async def _get_applications_payload(
    limit: int = 20,
    cursor: str | None = None,
) -> dict:
    """Return applications joined with job metadata using cursor pagination."""
    client = db.get_client()
    query = """
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
    """
    params: list[object] = []
    if cursor is not None:
        cursor_result = await client.execute(
            """
            SELECT id, submittedAt, createdAt
            FROM Application
            WHERE id = ?
            LIMIT 1
            """,
            [cursor],
        )
        if cursor_result.rows:
            cursor_id, cursor_submitted_at, cursor_created_at = cursor_result.rows[0]
            cursor_sort_at = cursor_submitted_at or cursor_created_at
            query += """
            WHERE (
                COALESCE(a.submittedAt, a.createdAt) < ?
                OR (
                    COALESCE(a.submittedAt, a.createdAt) = ?
                    AND a.id < ?
                )
            )
            """
            params.extend([cursor_sort_at, cursor_sort_at, cursor_id])
    query += """
        ORDER BY COALESCE(a.submittedAt, a.createdAt) DESC, a.id DESC
        LIMIT ?
        """
    params.append(limit + 1)
    result = await client.execute(query, params)
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
    next_cursor = None
    if len(applications) > limit:
        last_row = applications.pop()
        next_cursor = last_row["id"]
    return {"applications": applications, "nextCursor": next_cursor}


async def _get_recruiters_payload(
    company: str | None = None,
    limit: int = 20,
    cursor: str | None = None,
) -> dict:
    """Return recruiters using cursor pagination."""
    client = db.get_client()
    query = """
        SELECT id, name, title, company, linkedinUrl, email, relevanceScore,
               contactedAt, linkedinSentAt, createdAt
        FROM Recruiter
        WHERE 1 = 1
    """
    params: list[object] = []

    if company:
        query += """
          AND LOWER(company) LIKE LOWER(?)
        """
        params.append(f"%{company}%")

    if cursor is not None:
        cursor_result = await client.execute(
            """
            SELECT id, relevanceScore, createdAt
            FROM Recruiter
            WHERE id = ?
            LIMIT 1
            """,
            [cursor],
        )
        if cursor_result.rows:
            cursor_id, cursor_score, cursor_created_at = cursor_result.rows[0]
            query += """
              AND (
                relevanceScore < ?
                OR (
                  relevanceScore = ?
                  AND (
                    createdAt < ?
                    OR (createdAt = ? AND id < ?)
                  )
                )
              )
            """
            params.extend(
                [
                    int(cursor_score or 0),
                    int(cursor_score or 0),
                    cursor_created_at,
                    cursor_created_at,
                    cursor_id,
                ]
            )

    query += """
        ORDER BY relevanceScore DESC, createdAt DESC, id DESC
        LIMIT ?
    """
    params.append(limit + 1)

    result = await client.execute(query, params)
    columns = [
        c.name if hasattr(c, "name") else str(c)
        for c in result.columns
    ]
    recruiters = [dict(zip(columns, row)) for row in result.rows]

    next_cursor = None
    if len(recruiters) > limit:
        last_row = recruiters.pop()
        next_cursor = last_row["id"]

    return {"recruiters": recruiters, "nextCursor": next_cursor}


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
async def jobs_approve(job_id: str, request: Request):
    use_resume_tailor = False
    run_recruiter_search = False

    try:
        payload = await request.json()
        if isinstance(payload, dict):
            use_resume_tailor = bool(payload.get("useResumeTailor", False))
            run_recruiter_search = bool(payload.get("runRecruiterSearch", False))
    except Exception:
        pass

    await db.update_job_apply_options(
        job_id,
        use_resume_tailor=use_resume_tailor,
        run_recruiter_search=run_recruiter_search,
    )
    await db.update_job_status(job_id, "approved")
    return {
        "status": "ok",
        "job_id": job_id,
        "queued_for_apply": True,
        "useResumeTailor": use_resume_tailor,
        "runRecruiterSearch": run_recruiter_search,
    }


@app.post("/jobs/skip/{job_id}")
async def jobs_skip(job_id: str):
    await db.update_job_status(job_id, "skipped")
    return {"status": "ok", "job_id": job_id}


@app.get("/jobs/queue")
async def jobs_queue(limit: int = 20, cursor: str | None = None):
    return await _get_pending_jobs_payload(limit=limit, cursor=cursor)


@app.get("/jobs/retry-queue")
async def jobs_retry_queue():
    jobs = await db.get_retry_queued_jobs()
    return {"jobs": jobs}


@app.get("/referrals")
async def referrals(limit: int = 20, cursor: str | None = None):
    return await db.get_instagram_posts(limit=limit, cursor=cursor)


@app.get("/dashboard/stats")
async def dashboard_stats():
    return await _get_dashboard_stats()


@app.get("/applications/recent")
async def recent_applications():
    return await _get_applications_payload(limit=10, cursor=None)


@app.get("/applications")
async def applications(limit: int = 20, cursor: str | None = None):
    return await _get_applications_payload(limit=limit, cursor=cursor)


# ── Application batch ────────────────────────────────────────────────────────

@app.post("/agent/run-batch")
async def run_batch():
    """Fetch all approved jobs and run application batch."""
    approved_jobs, retry_jobs, jobs_to_process = await _get_application_batch_jobs()
    if not jobs_to_process:
        return {"status": "ok", "message": "No approved or due retry jobs"}
    results = await run_application_batch(jobs_to_process)
    applied = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    return {
        "status": "ok",
        "applied": applied,
        "failed": failed,
        "approved_jobs": len(approved_jobs),
        "retry_jobs": len(retry_jobs),
        "results": [
            {"job_id": r.job_id, "status": r.status, "error": r.error}
            for r in results
        ],
    }


# ── Recruiter search ─────────────────────────────────────────────────────────

@app.get("/recruiters")
async def recruiters(company: str | None = None, limit: int = 20, cursor: str | None = None):
    return await _get_recruiters_payload(
        company=company,
        limit=limit,
        cursor=cursor,
    )

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
