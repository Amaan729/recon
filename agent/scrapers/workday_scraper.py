"""
Workday scraper for public job boards using the internal JSON API.
Fetches internship and new grad listings every 4 hours and writes
qualifying jobs to the Turso DB via agent/db.py.
"""

import asyncio
import logging
import os
import re
import sys

import httpx

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from scrapers.filters import passes_basic_filter

logger = logging.getLogger(__name__)

WORKDAY_SUBDOMAINS = ["wd1", "wd2", "wd3", "wd4", "wd5"]

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}


def _board_candidates(slug: str) -> list[str]:
    board = re.sub(r"[^a-z0-9_-]+", "-", slug.lower()).strip("-") or slug
    candidates = [board]
    external_board = f"{board}-External"
    if external_board not in candidates:
        candidates.append(external_board)
    return candidates


async def _post_workday_search(
    slug: str,
    subdomain: str,
    search_text: str,
    limit: int,
    offset: int,
    client: httpx.AsyncClient,
) -> tuple[list[dict] | None, str | None]:
    payload = {
        "appliedFacets": {},
        "limit": limit,
        "offset": offset,
        "searchText": search_text,
    }

    for board in _board_candidates(slug):
        url = (
            f"https://{slug}.{subdomain}.myworkdayjobs.com/"
            f"wday/cxs/{slug}/{board}/jobs"
        )
        try:
            resp = await client.post(url, json=payload)
        except Exception:
            continue

        if resp.status_code == 404:
            continue
        if resp.status_code != 200:
            return None, None

        try:
            data = resp.json()
        except Exception:
            return None, None

        postings = data.get("jobPostings")
        if isinstance(postings, list):
            return postings, board

    return None, None


async def _find_working_subdomain(
    slug: str,
    client: httpx.AsyncClient,
) -> str | None:
    for subdomain in WORKDAY_SUBDOMAINS:
        postings, _ = await _post_workday_search(
            slug=slug,
            subdomain=subdomain,
            search_text="intern",
            limit=1,
            offset=0,
            client=client,
        )
        if postings is not None:
            return subdomain
    return None


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


async def _scrape_workday_slug(
    slug: str,
    company: str,
    subdomain: str,
    client: httpx.AsyncClient,
) -> int:
    try:
        combined: dict[str, tuple[dict, str]] = {}
        successful_fetch = False

        for search_text in ("intern", "new grad"):
            postings, board = await _post_workday_search(
                slug=slug,
                subdomain=subdomain,
                search_text=search_text,
                limit=20,
                offset=0,
                client=client,
            )
            if postings is None or board is None:
                continue
            successful_fetch = True

            for posting in postings:
                external_path = (posting.get("externalPath") or "").strip()
                if not external_path:
                    continue
                combined[external_path] = (posting, board)

        if not successful_fetch:
            raise RuntimeError("Workday API returned no valid responses")

        inserted = 0
        for external_path, (posting, board) in combined.items():
            title = (posting.get("title") or "").strip()
            if not title:
                continue

            location = (posting.get("locationsText") or "").strip() or None
            path = (
                external_path if external_path.startswith("/")
                else f"/{external_path}"
            )
            url = (
                f"https://{slug}.{subdomain}.myworkdayjobs.com/"
                f"{board}{path}"
            )
            job = {
                "title": title,
                "company": company,
                "location": location,
                "job_board_url": url,
                "source": "workday",
            }
            if not passes_basic_filter(job):
                continue
            if await _insert_job_if_new(job):
                inserted += 1

        await db.update_ats_slug_scraped(slug, "workday")
        return inserted
    except Exception as e:
        logger.warning("Workday scrape failed for '%s': %s", slug, e)
        print(f"Error fetching Workday jobs for '{slug}': {e}")
        return 0


async def main() -> None:
    """
    Main entry point for APScheduler.
    1. Load all active Workday slugs
    2. Probe each slug for a working wd1-wd5 subdomain
    3. Scrape working slugs concurrently
    4. Insert passing jobs into Turso (dedup handled by URL checks)
    5. Print summary
    """
    print("Starting Workday scraper...")
    slugs = await db.get_active_ats_slugs(board="workday")

    if not slugs:
        print("No Workday slugs configured — skipping")
        return

    print(f"Loaded {len(slugs)} active Workday slugs")

    inserted = 0
    skipped = 0
    subdomain_cache: dict[str, str | None] = {}
    working_slugs: list[tuple[str, str, str]] = []

    async with httpx.AsyncClient(timeout=30, headers=HEADERS) as client:
        for row in slugs:
            slug = row["slug"]
            company = row["company"]

            if slug not in subdomain_cache:
                subdomain_cache[slug] = await _find_working_subdomain(slug, client)

            subdomain = subdomain_cache[slug]
            if subdomain is None:
                logger.warning("No working Workday subdomain found for '%s'", slug)
                print(f"No working Workday subdomain found for '{slug}'")
                skipped += 1
                continue

            working_slugs.append((slug, company, subdomain))

        if working_slugs:
            results = await asyncio.gather(*[
                _scrape_workday_slug(slug, company, subdomain, client)
                for slug, company, subdomain in working_slugs
            ])
            inserted = sum(results)

    print(f"Done — inserted: {inserted} | skipped: {skipped} | slugs: {len(slugs)}")


if __name__ == "__main__":
    asyncio.run(main())
