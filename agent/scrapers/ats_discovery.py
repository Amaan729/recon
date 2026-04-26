"""
ATS discovery scraper using Google site: searches via Camoufox.
Finds new ATS slugs once per day, stores them in Turso, and immediately
scrapes newly discovered Greenhouse, Lever, and Ashby boards.
"""

import asyncio
import logging
import os
import random
import re
import sys
import urllib.parse

import httpx

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db

logger = logging.getLogger(__name__)

GOOGLE_SEARCH_URL = "https://www.google.com/search?q={query}&num=20"

GREENHOUSE_RE = re.compile(
    r"greenhouse\.io/boards/([a-z0-9_-]+)",
    re.IGNORECASE,
)
LEVER_RE = re.compile(
    r"jobs\.lever\.co/([a-z0-9_-]+)",
    re.IGNORECASE,
)
ASHBY_RE = re.compile(
    r"jobs\.ashbyhq\.com/([a-z0-9_-]+)",
    re.IGNORECASE,
)
WORKDAY_RE = re.compile(
    r"([a-z0-9_-]+)\.wd[1-5]\.myworkdayjobs\.com",
    re.IGNORECASE,
)

SEARCH_QUERIES = [
    (
        "greenhouse",
        "site:greenhouse.io/boards internship 2025 OR 2026 software",
    ),
    (
        "lever",
        "site:jobs.lever.co internship 2025 OR 2026 software engineer",
    ),
    (
        "ashby",
        "site:jobs.ashbyhq.com internship 2025 OR 2026 software",
    ),
    (
        "workday",
        "site:myworkdayjobs.com internship 2025 OR 2026 software engineer",
    ),
]

BOARD_PATTERNS = {
    "greenhouse": GREENHOUSE_RE,
    "lever": LEVER_RE,
    "ashby": ASHBY_RE,
    "workday": WORKDAY_RE,
}


async def _google_search(query: str, page) -> str:
    url = GOOGLE_SEARCH_URL.format(query=urllib.parse.quote_plus(query))
    await page.goto(url, wait_until="domcontentloaded")
    await asyncio.sleep(random.uniform(3, 5))
    return await page.content()


async def _extract_and_upsert_slugs(
    html: str,
    board: str,
) -> list[tuple[str, str]]:
    pattern = BOARD_PATTERNS[board]
    existing_rows = await db.get_active_ats_slugs(board)
    existing_slugs = {
        str(row.get("slug", "")).strip().lower()
        for row in existing_rows
        if row.get("slug")
    }

    found_slugs = {
        match.lower()
        for match in pattern.findall(html)
        if match
    }

    new_slugs: list[tuple[str, str]] = []
    for slug in sorted(found_slugs):
        if slug in existing_slugs:
            continue

        company = slug.replace("-", " ").title()
        await db.upsert_ats_slug(slug, board, company)
        existing_slugs.add(slug)
        new_slugs.append((slug, company))

    return new_slugs


async def _scrape_new_slugs_immediately(
    new_slugs: list[tuple[str, str]],
    board: str,
) -> int:
    if not new_slugs:
        return 0

    if board == "workday":
        return 0

    from scrapers.ats_api import (
        _scrape_ashby,
        _scrape_greenhouse,
        _scrape_lever,
    )

    async with httpx.AsyncClient(timeout=30) as client:
        if board == "greenhouse":
            results = await asyncio.gather(*[
                _scrape_greenhouse(slug, company, client)
                for slug, company in new_slugs
            ])
        elif board == "lever":
            results = await asyncio.gather(*[
                _scrape_lever(slug, company, client)
                for slug, company in new_slugs
            ])
        elif board == "ashby":
            results = await asyncio.gather(*[
                _scrape_ashby(slug, company, client)
                for slug, company in new_slugs
            ])
        else:
            return 0

    return sum(results)


async def main() -> None:
    """
    Daily ATS discovery entry point for APScheduler.
    Uses Camoufox to run Google site: searches sequentially with delays,
    stores any new ATS slugs, and immediately scrapes supported boards.
    """
    try:
        from camoufox.async_api import AsyncCamoufox
    except ImportError:
        logger.warning("Camoufox is not installed - skipping ATS discovery")
        return

    print("Starting ATS discovery scraper...")

    browser_cm = None
    page = None

    try:
        browser_cm = AsyncCamoufox(headless=True, geoip=True)
        browser = await browser_cm.__aenter__()
        page = await browser.new_page()

        for index, (board, query) in enumerate(SEARCH_QUERIES):
            try:
                print(f"Searching Google for new {board} slugs...")
                html = await _google_search(query, page)
                new_slugs = await _extract_and_upsert_slugs(html, board)
                inserted = await _scrape_new_slugs_immediately(new_slugs, board)
                print(
                    f"ATS discovery {board}: "
                    f"{len(new_slugs)} new slugs, {inserted} jobs inserted"
                )
            except Exception as e:
                logger.warning("ATS discovery failed for '%s': %s", board, e)
                print(f"ATS discovery failed for '{board}': {e}")

            if index < len(SEARCH_QUERIES) - 1:
                await asyncio.sleep(random.uniform(8, 15))
    except Exception as e:
        logger.warning("ATS discovery run failed: %s", e)
        print(f"ATS discovery run failed: {e}")
        raise
    finally:
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
        if browser_cm is not None:
            try:
                await browser_cm.__aexit__(None, None, None)
            except Exception as e:
                logger.warning("Failed to close Camoufox cleanly: %s", e)


if __name__ == "__main__":
    asyncio.run(main())
