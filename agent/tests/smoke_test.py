"""
Smoke tests for the Recon agent pipeline.
Run with: DRY_RUN=true python -m pytest agent/tests/smoke_test.py -v
Does NOT submit to real job portals.
"""

from pathlib import Path
import sys

import httpx
import pytest

AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

import db


@pytest.mark.asyncio
async def test_1_db_connection():
    profile = await db.get_candidate_profile()
    assert isinstance(profile, dict)
    assert profile["firstName"] == "Amaan"


@pytest.mark.asyncio
async def test_2_ats_api_greenhouse_fetch():
    from scrapers.ats_api import _scrape_greenhouse

    async with httpx.AsyncClient() as client:
        result = await _scrape_greenhouse("stripe", "Stripe", client)

    assert isinstance(result, int)
    assert result >= 0


def test_3_filters():
    from scrapers.filters import passes_basic_filter

    assert passes_basic_filter({
        "title": "Software Engineer Intern",
        "company": "Stripe",
        "location": "San Francisco",
        "job_board_url": "https://example.com",
        "source": "greenhouse",
    }) is True
    assert passes_basic_filter({
        "title": "Senior Software Engineer",
        "company": "Stripe",
        "location": "San Francisco",
        "job_board_url": "https://example.com",
        "source": "greenhouse",
    }) is False


def test_4_llm_router_import():
    import llm_router

    for name in [
        "get_browser_nav_llm",
        "get_tailoring_llm",
        "get_cover_letter_llm",
        "get_email_llm",
        "get_json_extraction_llm",
    ]:
        assert hasattr(llm_router, name)


def test_5_tailor_import_and_prompt():
    from resume.tailor import CANDIDATE_PROFILE, RESUME_RULES, TailoringResult

    assert isinstance(CANDIDATE_PROFILE, str)
    assert CANDIDATE_PROFILE.strip()
    assert "Amaan" in CANDIDATE_PROFILE
    assert isinstance(RESUME_RULES, str)
    assert TailoringResult is not None


@pytest.mark.asyncio
async def test_6_scheduler_jobs():
    from scheduler.scheduler import get_job_statuses, get_scheduler

    scheduler = get_scheduler()
    scheduler.start()
    statuses = get_job_statuses()
    assert len(statuses) == 6
    scheduler.shutdown(wait=False)
