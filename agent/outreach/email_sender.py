"""
Email outreach sender.

When implemented, this module will:
- Pick up approved RecruiterOutreach records with channel=email
- Compose personalised cold emails using an AI provider, referencing the
  specific Job and Application context
- Send via Gmail OAuth (ASU Google Workspace) using the googleapis library
- Mark outreach as sent and record sentAt; on failure set status=failed
  with a reason stored in messageText for retry visibility
- Honour a daily send cap to avoid spam-filter penalties
"""
