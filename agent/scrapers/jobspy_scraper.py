"""
Multi-board job scraper powered by JobSpy.

When implemented, this module will:
- Query Greenhouse, Lever, Ashby, Workday, Handshake, and Simplify
  boards simultaneously using the jobspy library
- Normalise results into a common schema (title, company, location,
  jobBoardUrl, source, jdText)
- Score each posting against the active resume using Groq / Gemini
- Upsert Job records into Turso, skipping duplicates already in the DB
- Emit a summary to stdout for GitHub Actions log visibility

Run standalone via `python agent/scrapers/jobspy_scraper.py` or via
the GitHub Actions job_scraper workflow every 4 hours.
"""
