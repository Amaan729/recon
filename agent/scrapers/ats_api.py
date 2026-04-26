"""
ATS API scraper for Greenhouse, Lever, and Ashby public job boards.
Fetches internship/co-op listings every 4 hours and writes qualifying
jobs to the Turso DB via agent/db.py.
"""

import asyncio
from datetime import datetime, timezone
import logging
import os
import re
import sys

import httpx

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from scrapers.filters import passes_basic_filter

logger = logging.getLogger(__name__)

GREENHOUSE_SLUGS = [
    ("stripe", "Stripe"),
    ("airbnb", "Airbnb"),
    ("coinbase", "Coinbase"),
    ("figma", "Figma"),
    ("notion", "Notion"),
    ("rippling", "Rippling"),
    ("brex", "Brex"),
    ("scale-ai", "Scale AI"),
    ("openai", "OpenAI"),
    ("anthropic", "Anthropic"),
    ("databricks", "Databricks"),
    ("confluent", "Confluent"),
    ("hashicorp", "HashiCorp"),
    ("plaid", "Plaid"),
    ("chime", "Chime"),
    ("robinhood", "Robinhood"),
    ("carta", "Carta"),
    ("gusto", "Gusto"),
    ("lattice", "Lattice"),
    ("benchling", "Benchling"),
]

LEVER_SLUGS = [
    ("netflix", "Netflix"),
    ("twitter", "Twitter"),
    ("lyft", "Lyft"),
    ("square", "Square"),
    ("hubspot", "HubSpot"),
    ("intercom", "Intercom"),
    ("zendesk", "Zendesk"),
    ("klaviyo", "Klaviyo"),
    ("segment", "Segment"),
    ("retool", "Retool"),
    ("airtable", "Airtable"),
    ("linear", "Linear"),
    ("loom", "Loom"),
    ("mercury", "Mercury"),
    ("deel", "Deel"),
    ("remote", "Remote"),
    ("rippling", "Rippling"),
    ("coda", "Coda"),
    ("dbt-labs", "dbt Labs"),
    ("mixpanel", "Mixpanel"),
]

ASHBY_SLUGS = [
    ("vercel", "Vercel"),
    ("linear", "Linear"),
    ("resend", "Resend"),
    ("turso", "Turso"),
    ("neon", "Neon"),
    ("supabase", "Supabase"),
    ("planetscale", "PlanetScale"),
    ("railway", "Railway"),
    ("render", "Render"),
    ("fly-io", "Fly.io"),
    ("clerk", "Clerk"),
    ("convex", "Convex"),
    ("trigger", "Trigger.dev"),
    ("inngest", "Inngest"),
    ("stytch", "Stytch"),
]

GREENHOUSE_URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
LEVER_URL = "https://api.lever.co/v0/postings/{slug}"
ASHBY_URL = "https://api.ashbyhq.com/posting-api/job-board/{slug}"


def _strip_html(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"&nbsp;|&#160;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _coerce_iso(value) -> str | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        divisor = 1000 if value > 10_000_000_000 else 1
        return datetime.fromtimestamp(
            value / divisor, tz=timezone.utc
        ).isoformat()
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(raw).isoformat()
        except ValueError:
            return value
    return str(value)


def _normalize_greenhouse(raw: dict, slug: str, company: str) -> dict | None:
    title = (raw.get("title") or "").strip()
    url = (raw.get("absolute_url") or "").strip()
    location_obj = raw.get("location") or {}
    location = (location_obj.get("name") or "").strip() or None
    description = _strip_html(raw.get("content"))
    job = {
        "title": title,
        "company": company,
        "location": location,
        "job_board_url": url,
        "source": "greenhouse",
        "jd_text": description,
        "posted_at": _coerce_iso(raw.get("updated_at")),
        "slug": slug,
    }
    if not title or not url or not passes_basic_filter(job):
        return None
    return job


def _normalize_lever(raw: dict, slug: str, company: str) -> dict | None:
    title = (raw.get("text") or "").strip()
    url = (raw.get("hostedUrl") or "").strip()
    categories = raw.get("categories") or {}
    location = (categories.get("location") or "").strip() or None
    description = _strip_html(raw.get("descriptionPlain"))
    job = {
        "title": title,
        "company": company,
        "location": location,
        "job_board_url": url,
        "source": "lever",
        "jd_text": description,
        "posted_at": _coerce_iso(raw.get("createdAt")),
        "slug": slug,
    }
    if not title or not url or not passes_basic_filter(job):
        return None
    return job


def _normalize_ashby(raw: dict, slug: str, company: str) -> dict | None:
    title = (raw.get("title") or "").strip()
    url = (raw.get("jobUrl") or "").strip()
    if url and not url.startswith("http"):
        url = f"https://jobs.ashbyhq.com/{slug}/{url.lstrip('/')}"
    location = (raw.get("locationName") or "").strip() or None
    description = _strip_html(raw.get("descriptionHtml"))
    job = {
        "title": title,
        "company": company,
        "location": location,
        "job_board_url": url,
        "source": "ashby",
        "jd_text": description,
        "posted_at": _coerce_iso(raw.get("publishedDate")),
        "slug": slug,
    }
    if not title or not url or not passes_basic_filter(job):
        return None
    return job


async def _insert_job_if_new(job: dict) -> bool:
    client = db.get_client()
    existing = await client.execute(
        "SELECT id FROM Job WHERE jobBoardUrl = ?",
        [job["job_board_url"]],
    )
    if existing.rows:
        return False

    await db.insert_job(
        title=job["title"],
        company=job["company"],
        job_board_url=job["job_board_url"],
        source=job["source"],
        location=job.get("location"),
        jd_text=job.get("jd_text"),
        is_top_priority=False,
    )
    return True


async def _scrape_greenhouse(
    slug: str,
    company: str,
    client: httpx.AsyncClient,
) -> int:
    try:
        resp = await client.get(
            GREENHOUSE_URL.format(slug=slug),
            params={"content": "true"},
        )
        if resp.status_code != 200:
            print(f"Greenhouse API returned {resp.status_code} for '{slug}'")
            return 0
        payload = resp.json()
        raw_jobs = payload.get("jobs", [])
        inserted = 0
        for raw_job in raw_jobs:
            job = _normalize_greenhouse(raw_job, slug, company)
            if job is None:
                continue
            if await _insert_job_if_new(job):
                inserted += 1
        await db.update_ats_slug_scraped(slug, "greenhouse")
        return inserted
    except Exception as e:
        logger.warning("Greenhouse scrape failed for '%s': %s", slug, e)
        print(f"Error fetching Greenhouse jobs for '{slug}': {e}")
        return 0


async def _scrape_lever(
    slug: str,
    company: str,
    client: httpx.AsyncClient,
) -> int:
    try:
        resp = await client.get(
            LEVER_URL.format(slug=slug),
            params={"mode": "json"},
        )
        if resp.status_code != 200:
            print(f"Lever API returned {resp.status_code} for '{slug}'")
            return 0
        raw_jobs = resp.json()
        inserted = 0
        for raw_job in raw_jobs:
            job = _normalize_lever(raw_job, slug, company)
            if job is None:
                continue
            if await _insert_job_if_new(job):
                inserted += 1
        await db.update_ats_slug_scraped(slug, "lever")
        return inserted
    except Exception as e:
        logger.warning("Lever scrape failed for '%s': %s", slug, e)
        print(f"Error fetching Lever jobs for '{slug}': {e}")
        return 0


async def _scrape_ashby(
    slug: str,
    company: str,
    client: httpx.AsyncClient,
) -> int:
    try:
        resp = await client.post(
            ASHBY_URL.format(slug=slug),
            json={"limit": 100},
        )
        if resp.status_code != 200:
            print(f"Ashby API returned {resp.status_code} for '{slug}'")
            return 0
        payload = resp.json()
        raw_jobs = payload.get("results", [])
        inserted = 0
        for raw_job in raw_jobs:
            job = _normalize_ashby(raw_job, slug, company)
            if job is None:
                continue
            if await _insert_job_if_new(job):
                inserted += 1
        await db.update_ats_slug_scraped(slug, "ashby")
        return inserted
    except Exception as e:
        logger.warning("Ashby scrape failed for '%s': %s", slug, e)
        print(f"Error fetching Ashby jobs for '{slug}': {e}")
        return 0


async def _seed_slugs_if_empty() -> None:
    client = db.get_client()
    result = await client.execute("SELECT COUNT(*) FROM AtsSlugs")
    existing_count = int(result.rows[0][0]) if result.rows else 0
    if existing_count > 0:
        return

    seeded = 0
    for slug, company in GREENHOUSE_SLUGS:
        await db.upsert_ats_slug(slug, "greenhouse", company)
        seeded += 1
    for slug, company in LEVER_SLUGS:
        await db.upsert_ats_slug(slug, "lever", company)
        seeded += 1
    for slug, company in ASHBY_SLUGS:
        await db.upsert_ats_slug(slug, "ashby", company)
        seeded += 1

    print(f"Seeded {seeded} ATS slugs")


async def main() -> None:
    """
    Main entry point for APScheduler.
    1. Seed known ATS slugs if the table is empty
    2. Fetch all active slugs
    3. Scrape Greenhouse, Lever, and Ashby concurrently
    4. Insert passing jobs into Turso (dedup handled by URL checks)
    5. Print summary
    """
    print("Starting ATS API scraper...")
    await _seed_slugs_if_empty()

    slugs = await db.get_active_ats_slugs()
    print(f"Loaded {len(slugs)} active ATS slugs")

    greenhouse_slugs = [
        row for row in slugs if row.get("atsBoard") == "greenhouse"
    ]
    lever_slugs = [
        row for row in slugs if row.get("atsBoard") == "lever"
    ]
    ashby_slugs = [
        row for row in slugs if row.get("atsBoard") == "ashby"
    ]

    async with httpx.AsyncClient(timeout=30) as client:
        greenhouse_results = await asyncio.gather(*[
            _scrape_greenhouse(row["slug"], row["company"], client)
            for row in greenhouse_slugs
        ])
        lever_results = await asyncio.gather(*[
            _scrape_lever(row["slug"], row["company"], client)
            for row in lever_slugs
        ])
        ashby_results = await asyncio.gather(*[
            _scrape_ashby(row["slug"], row["company"], client)
            for row in ashby_slugs
        ])

    inserted = (
        sum(greenhouse_results)
        + sum(lever_results)
        + sum(ashby_results)
    )
    print(
        "Found "
        f"{sum(greenhouse_results)} greenhouse, "
        f"{sum(lever_results)} lever, "
        f"{sum(ashby_results)} ashby jobs"
    )
    print(f"Done — inserted: {inserted} | skipped: 0 | boards: 3")


if __name__ == "__main__":
    asyncio.run(main())
