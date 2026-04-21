# Recon

Recon is a job-hunting automation monorepo that combines a Next.js dashboard (MailSuite Pro) with a Python agent that scrapes job boards, tailors resumes, autonomously fills out applications, and queues recruiter outreach — all without leaving your chair. You review a short approval queue each morning; the agent handles the grunt work around the clock.

---

## Monorepo structure

```
recon/
├── web/                          ← MailSuite Pro Next.js app
│   ├── src/
│   ├── prisma/
│   ├── public/
│   ├── chrome-extension/
│   └── package.json
├── agent/
│   ├── scrapers/
│   │   ├── linkedin.py           ← LinkedIn job scraper (Apify)
│   │   ├── jobspy_scraper.py     ← Multi-board scraper (Greenhouse/Lever/etc.)
│   │   └── instagram.py          ← Instagram referral monitor (Apify)
│   ├── browser/
│   │   └── application_agent.py  ← Playwright-based form-filler
│   ├── resume/
│   │   ├── tailor.py             ← AI resume tailoring
│   │   └── compile.py            ← LaTeX → PDF compiler
│   ├── outreach/
│   │   ├── linkedin_queue.py     ← Recruiter discovery & queue
│   │   └── email_sender.py       ← Gmail cold-email sender
│   ├── scheduler/
│   ├── main.py                   ← FastAPI entry point
│   ├── requirements.txt
│   └── .env.example
├── shared/
│   └── schema_additions.prisma   ← Job, Application, Recruiter models
├── .github/
│   └── workflows/
│       ├── job_scraper.yml       ← Runs every 4 hours
│       └── instagram_monitor.yml ← Runs 3× / day
├── .gitignore
└── README.md
```

---

## Running web/ locally

```bash
cd web
npm install
npm run dev        # starts Next.js on http://localhost:3000
```

Copy `web/.env.local` (not committed) and set `DATABASE_URL`, `NEXTAUTH_SECRET`, and your Gmail OAuth credentials before running.

---

## Running agent/ locally

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real values
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

---

## Environment variables

All required variables are documented in `agent/.env.example`. Key groups:

| Group | Variables |
|---|---|
| Database | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` |
| AI providers | `GOOGLE_AI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY` |
| Gmail OAuth | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` |
| Job scraping | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX` |
| Email enrichment | `APOLLO_API_KEY`, `HUNTER_API_KEY` |
| Instagram | `APIFY_API_KEY` |

For GitHub Actions, add each variable as a repository secret under **Settings → Secrets and variables → Actions**.

---

## GitHub Actions

| Workflow | Schedule | What it does |
|---|---|---|
| `job_scraper.yml` | Every 4 hours (`0 */4 * * *`) | Runs `linkedin.py` and `jobspy_scraper.py` to pull new job postings |
| `instagram_monitor.yml` | 8am, 2pm, 8pm UTC (`0 8,14,20 * * *`) | Runs `instagram.py` to capture referral posts from tracked accounts |

Both workflows can also be triggered manually from the **Actions** tab via `workflow_dispatch`.
