"""
LinkedIn outreach queue manager.

When implemented, this module will:
- Query Application records that have been submitted and lack recruiter outreach
- Use the Apollo / Hunter APIs to find recruiter emails and LinkedIn profiles
  at the target company
- Score recruiter relevance (hiring manager > recruiter > engineer) and store
  in Recruiter.relevanceScore
- Enqueue RecruiterOutreach records with status=queued for the dashboard's
  batch-approval flow
- Respect LinkedIn rate limits: no more than ~20 connection requests per day
  and ~5 InMails per month (tracked via sentAt timestamps)
"""
