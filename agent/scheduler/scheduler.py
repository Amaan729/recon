"""
APScheduler setup for the Recon agent.
Runs all scrapers on a fixed schedule inside the FastAPI process.
Replaces GitHub Actions cron jobs — Railway keeps this container alive 24/7.
"""

import logging
from datetime import datetime, timezone
from typing import Callable, Awaitable, Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

# ── Scraper imports (stubs wrapped in try/except) ─────────────────

try:
    from scrapers.linkedin import main as linkedin_main
except ImportError:
    linkedin_main = None  # type: ignore[assignment]
    print("[scheduler] WARNING: scrapers.linkedin not found — job will skip")

try:
    from scrapers.instagram import main as instagram_main
except ImportError:
    instagram_main = None  # type: ignore[assignment]
    print("[scheduler] WARNING: scrapers.instagram not found — job will skip")

try:
    from scrapers.ats_api import main as ats_api_main  # type: ignore[import]
except ImportError:
    ats_api_main = None  # type: ignore[assignment]
    print("[scheduler] WARNING: scrapers.ats_api not found — stub, will run when implemented")

try:
    from scrapers.workday_scraper import main as workday_main  # type: ignore[import]
except ImportError:
    workday_main = None  # type: ignore[assignment]
    print("[scheduler] WARNING: scrapers.workday_scraper not found — stub, will run when implemented")

try:
    from scrapers.ats_discovery import main as ats_discovery_main  # type: ignore[import]
except ImportError:
    ats_discovery_main = None  # type: ignore[assignment]
    print("[scheduler] WARNING: scrapers.ats_discovery not found — stub, will run when implemented")

try:
    from scrapers.icims_scraper import main as icims_main  # type: ignore[import]
except ImportError:
    icims_main = None  # type: ignore[assignment]
    print("[scheduler] WARNING: scrapers.icims_scraper not found — stub, will run when implemented")


# ── State tracking ────────────────────────────────────────────────

_scheduler: AsyncIOScheduler | None = None
_broadcast_fn: Callable[..., Awaitable[Any]] | None = None

_job_run_state: dict[str, dict] = {
    "linkedin":      {"status": "never", "last_run_at": None},
    "ats_api":       {"status": "never", "last_run_at": None},
    "workday":       {"status": "never", "last_run_at": None},
    "instagram":     {"status": "never", "last_run_at": None},
    "ats_discovery": {"status": "never", "last_run_at": None},
    "icims":         {"status": "never", "last_run_at": None},
}


# ── Logging helper ────────────────────────────────────────────────

async def _log(message: str) -> None:
    """Log to stdout and optionally broadcast to WebSocket clients."""
    print(f"[scheduler] {message}")
    if _broadcast_fn is not None:
        try:
            await _broadcast_fn({"type": "action", "message": f"[scheduler] {message}"})
        except Exception:
            pass


# ── Job runner wrapper ────────────────────────────────────────────

async def _run_job(job_id: str, fn, job_name: str) -> None:
    """
    Wrap a scraper main() call with logging and error isolation.
    A crash here is caught and recorded — it never reaches APScheduler.
    """
    if fn is None:
        await _log(f"{job_name}: scraper not implemented yet — skipping")
        return

    _job_run_state[job_id]["last_run_at"] = datetime.now(timezone.utc).isoformat()
    _job_run_state[job_id]["status"] = "running"
    await _log(f"{job_name}: starting")

    try:
        await fn()
        _job_run_state[job_id]["status"] = "success"
        _job_run_state[job_id]["last_run_at"] = datetime.now(timezone.utc).isoformat()
        await _log(f"{job_name}: completed successfully")
    except Exception as exc:
        _job_run_state[job_id]["status"] = "failed"
        _job_run_state[job_id]["last_run_at"] = datetime.now(timezone.utc).isoformat()
        await _log(f"{job_name}: failed — {exc}")
        logger.exception("[scheduler] %s raised an exception", job_name)


# ── Individual job coroutines ─────────────────────────────────────

async def _job_linkedin() -> None:
    await _run_job("linkedin", linkedin_main, "LinkedIn scraper")

async def _job_ats_api() -> None:
    await _run_job("ats_api", ats_api_main, "ATS API scraper")

async def _job_workday() -> None:
    await _run_job("workday", workday_main, "Workday scraper")

async def _job_instagram() -> None:
    await _run_job("instagram", instagram_main, "Instagram monitor")

async def _job_ats_discovery() -> None:
    await _run_job("ats_discovery", ats_discovery_main, "ATS discovery")

async def _job_icims() -> None:
    await _run_job("icims", icims_main, "iCIMS scraper")


# ── Job registration ──────────────────────────────────────────────

def _register_jobs(scheduler: AsyncIOScheduler) -> None:
    scheduler.add_job(
        _job_linkedin,
        trigger=IntervalTrigger(hours=4),
        id="linkedin",
        name="LinkedIn scraper",
        replace_existing=True,
    )
    scheduler.add_job(
        _job_ats_api,
        trigger=IntervalTrigger(hours=4),
        id="ats_api",
        name="ATS API scraper",
        replace_existing=True,
    )
    scheduler.add_job(
        _job_workday,
        trigger=IntervalTrigger(hours=4),
        id="workday",
        name="Workday scraper",
        replace_existing=True,
    )
    # Instagram: 3x/day at 08:00, 14:00, 20:00 UTC
    scheduler.add_job(
        _job_instagram,
        trigger=CronTrigger(hour="8,14,20", minute=0, timezone="UTC"),
        id="instagram",
        name="Instagram monitor",
        replace_existing=True,
    )
    # ATS discovery: once/day at 06:00 UTC
    scheduler.add_job(
        _job_ats_discovery,
        trigger=CronTrigger(hour=6, minute=0, timezone="UTC"),
        id="ats_discovery",
        name="ATS discovery",
        replace_existing=True,
    )
    # iCIMS: once/day at 06:30 UTC
    scheduler.add_job(
        _job_icims,
        trigger=CronTrigger(hour=6, minute=30, timezone="UTC"),
        id="icims",
        name="iCIMS scraper",
        replace_existing=True,
    )


# ── Public API ────────────────────────────────────────────────────

def get_scheduler(
    broadcast_fn: Callable[..., Awaitable[Any]] | None = None,
) -> AsyncIOScheduler:
    """Return (and lazily create) the singleton AsyncIOScheduler instance."""
    global _scheduler, _broadcast_fn
    if broadcast_fn is not None:
        _broadcast_fn = broadcast_fn
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
        _register_jobs(_scheduler)
    return _scheduler


def get_job_statuses() -> list[dict]:
    """Return runtime status for every registered job."""
    if _scheduler is None:
        return []
    statuses = []
    for job in _scheduler.get_jobs():
        run_state = _job_run_state.get(
            job.id, {"status": "never", "last_run_at": None}
        )
        # next_run_time only exists after scheduler.start() — pending jobs don't have it
        raw_next = getattr(job, "next_run_time", None)
        next_run = raw_next.isoformat() if raw_next else None
        statuses.append({
            "job_id": job.id,
            "next_run_time": next_run,
            "last_run_status": run_state["status"],
            "last_run_at": run_state["last_run_at"],
        })
    return statuses
