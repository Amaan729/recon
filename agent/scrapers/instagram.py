"""
Instagram job-referral monitor.

When implemented, this module will:
- Use the Apify Instagram Scraper actor to watch designated accounts
  (e.g. zero2sudo, tech-referral pages) for new posts
- Parse post captions for job role, company, and application link
- Create Job records with isTopPriority=True so they surface at the
  top of the dashboard queue
- Avoid re-processing posts already saved (dedup by Instagram post ID
  stored in jdText or a dedicated field)

Run standalone via `python agent/scrapers/instagram.py` or via the
GitHub Actions instagram_monitor workflow at 8am, 2pm, and 8pm UTC.
"""
