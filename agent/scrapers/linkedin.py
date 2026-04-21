"""
LinkedIn job scraper.

When implemented, this module will:
- Use the Apify LinkedIn Jobs Scraper actor to pull fresh postings
- Filter by role keywords (SWE, MLE, backend, etc.) and recency
- Score each posting with an AI match score (0–100) against the user's resume
- Upsert Job records into the Turso database, deduplicating by jobBoardUrl
- Flag zero2sudo / Instagram-sourced referrals as isTopPriority=True

Run standalone via `python agent/scrapers/linkedin.py` or via the
GitHub Actions job_scraper workflow every 4 hours.
"""
