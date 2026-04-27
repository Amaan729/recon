"""
iCIMS scraper using Camoufox-rendered curated career pages.
Extracts internship job cards from rendered HTML and inserts matches
into Turso via agent/db.py.
"""

import asyncio
import html as html_lib
import logging
import os
import random
import re
import sys
from urllib.parse import urljoin

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from scrapers.filters import passes_basic_filter

logger = logging.getLogger(__name__)

ICIMS_PAGES = [
    {
        "company": "T-Mobile",
        "url": "https://careers.t-mobile.com/us/en/search-results?keywords=intern",
    },
    {
        "company": "Qualcomm",
        "url": "https://careers.qualcomm.com/careers/search?keywords=intern",
    },
    {
        "company": "Lockheed Martin",
        "url": "https://www.lockheedmartinjobs.com/search-jobs/intern",
    },
    {
        "company": "Raytheon",
        "url": "https://jobs.rtx.com/search-jobs/intern",
    },
    {
        "company": "BAE Systems",
        "url": "https://jobs.baesystems.com/global/en/search-results?keywords=intern",
    },
]

_JOB_LINK_RE = re.compile(
    r"<a\b[^>]*href=[\"'](?P<href>[^\"']*(?:/job/|/jobs/|icims\.com)[^\"']*)[\"'][^>]*>"
    r"(?P<body>.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)
_TITLE_CLASS_RE = re.compile(
    r"<[^>]*class=[\"'][^\"']*(?:job-title|title)[^\"']*[\"'][^>]*>(.*?)</[^>]+>",
    re.IGNORECASE | re.DOTALL,
)
_HEADING_RE = re.compile(
    r"<h[23][^>]*>(.*?)</h[23]>",
    re.IGNORECASE | re.DOTALL,
)
_LOCATION_RE = re.compile(
    r"<[^>]*class=[\"'][^\"']*(?:job-location|location)[^\"']*[\"'][^>]*>(.*?)</[^>]+>",
    re.IGNORECASE | re.DOTALL,
)
_WHITESPACE_RE = re.compile(r"\s+")


def _clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = html_lib.unescape(text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def _is_valid_job_url(href: str) -> bool:
    lowered = href.lower()
    return (
        "/job/" in lowered
        or "/jobs/" in lowered
        or "icims.com" in lowered
    )


def _extract_title(anchor_body: str, snippet: str) -> str:
    for pattern in (_HEADING_RE, _TITLE_CLASS_RE):
        match = pattern.search(snippet)
        if match:
            title = _clean_text(match.group(1))
            if title:
                return title

    title = _clean_text(anchor_body)
    if title:
        return title

    # Fall back to any title-ish node in the snippet when the link text is sparse.
    match = _TITLE_CLASS_RE.search(snippet)
    if match:
        return _clean_text(match.group(1))

    return ""


def _extract_location(snippet: str) -> str | None:
    match = _LOCATION_RE.search(snippet)
    if not match:
        return None
    location = _clean_text(match.group(1))
    return location or None


def _extract_job_cards(
    rendered_html: str,
    page_url: str,
    company: str,
) -> list[dict]:
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for match in _JOB_LINK_RE.finditer(rendered_html):
        raw_href = (match.group("href") or "").strip()
        if not raw_href or not _is_valid_job_url(raw_href):
            continue

        normalized_url = urljoin(page_url, html_lib.unescape(raw_href))
        if normalized_url in seen_urls:
            continue

        snippet_start = max(0, match.start() - 1500)
        snippet_end = min(len(rendered_html), match.end() + 1500)
        snippet = rendered_html[snippet_start:snippet_end]

        title = _extract_title(match.group("body") or "", snippet)
        if not title:
            continue

        jobs.append({
            "title": title,
            "company": company,
            "location": _extract_location(snippet),
            "url": normalized_url,
            "source": "icims",
        })
        seen_urls.add(normalized_url)

    return jobs


async def main() -> None:
    """
    Daily iCIMS scraper entrypoint for APScheduler.
    Uses Camoufox to render curated pages, then extracts internship job cards
    from the rendered HTML.
    """
    try:
        from camoufox.async_api import AsyncCamoufox
    except ImportError:
        logger.warning("Camoufox is not installed - skipping iCIMS scraper")
        return

    print("Starting iCIMS scraper...")

    browser_cm = None
    browser = None
    page = None
    total_inserted = 0

    try:
        browser_cm = AsyncCamoufox(headless=True, geoip=True)
        browser = await browser_cm.__aenter__()
        page = await browser.new_page()
        client = db.get_client()

        for company_page in ICIMS_PAGES:
            company = company_page["company"]
            url = company_page["url"]

            try:
                await page.goto(url, wait_until="domcontentloaded")
                await asyncio.sleep(random.uniform(4, 6))
                rendered_html = await page.content()

                jobs = _extract_job_cards(rendered_html, url, company)
                inserted = 0

                for job in jobs:
                    candidate = {
                        "title": job["title"],
                        "company": job["company"],
                        "location": job.get("location"),
                        "job_board_url": job["url"],
                        "source": job["source"],
                    }
                    if not passes_basic_filter(candidate):
                        continue

                    existing = await client.execute(
                        "SELECT id FROM Job WHERE jobBoardUrl = ?",
                        [job["url"]],
                    )
                    if existing.rows:
                        continue

                    inserted_id = await db.insert_job(
                        title=job["title"],
                        company=job["company"],
                        job_board_url=job["url"],
                        source=job["source"],
                        location=job.get("location"),
                    )
                    if inserted_id not in ("fuzzy_duplicate", ""):
                        inserted += 1

                total_inserted += inserted
                print(
                    f"iCIMS {company}: found {len(jobs)} jobs, inserted {inserted}"
                )
            except Exception as exc:
                logger.warning("iCIMS scrape failed for '%s': %s", company, exc)
                print(f"iCIMS scrape failed for '{company}': {exc}")
    finally:
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
        if browser_cm is not None:
            try:
                await browser_cm.__aexit__(None, None, None)
            except Exception as exc:
                logger.warning("Failed to close Camoufox cleanly: %s", exc)

    print(f"iCIMS scraper complete — total inserted: {total_inserted}")


if __name__ == "__main__":
    asyncio.run(main())
