"""
Browser-use application agent.

When implemented, this module will:
- Accept an approved Job record and its tailored resume path
- Launch a Playwright-controlled browser via the browser-use library
- Navigate to the job application portal (Greenhouse, Lever, Workday, etc.)
- Fill in form fields (name, email, LinkedIn URL, resume upload, cover letter)
  using structured data from the Job and User profiles
- Stream screenshots over the WebSocket endpoint (/agent/stream) so the
  user can monitor progress in the dashboard
- Report final status (submitted | failed | pending_review) back to the
  Application record in Turso
"""
