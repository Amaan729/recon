# MailSuite Pro

A full-stack email tracking dashboard built for job seekers and anyone who cold-emails at scale. Send tracked emails, watch opens in real time, attach resumes, and auto-detect when you open your own emails — all without a single watermark or "tracked by" footer visible to your recipient.

**Live:** [mailsuite-pro.vercel.app](https://mailsuite-pro.vercel.app)

---

## What it does

| Feature | Detail |
|---|---|
| **Email tracking** | 1×1 invisible pixel fires when recipient opens — logs IP, city, country, device, OS, browser |
| **Real-time dashboard** | Polls every 15 s; shows per-email open events with device and location |
| **Gmail extension** | Tracks emails you compose directly in Gmail, not just ones sent from the dashboard |
| **Self-open detection** | Extension watches your Gmail reading pane — if you open your own email it auto-marks it as a self-open so it doesn't pollute your stats |
| **Resume tracking** | Attach a PDF resume to any email; a "View Resume" CTA is embedded and PDF opens are tracked separately |
| **Follow-ups** | Manual (button appears when they've opened) or automatic (sends after N days if they opened but didn't reply) |
| **Contact book** | Auto-creates contacts from recipients; autocomplete in compose |
| **Gmail proxy labeling** | Gmail routes all image loads through Google's proxy, masking real device/location; the dashboard labels these clearly and warns when all opens look unreliable |

---

## Tech stack

### Backend / Full-stack
| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) — App Router, React Server Components, API Routes |
| Language | TypeScript (strict) |
| ORM | [Prisma 7](https://prisma.io) with the `@prisma/adapter-libsql` adapter |
| Database | [Turso](https://turso.tech) — cloud SQLite via libSQL (edge-friendly, zero cold-start) |
| Auth | [NextAuth v5 beta](https://authjs.dev) — Google OAuth, `@auth/prisma-adapter` |
| Email sending | Gmail API (OAuth 2.0) via `googleapis` — sends from your actual Gmail account |
| Geo / device | `ip-api.com` (free tier, no key needed) + custom UA parser |
| Deployment | [Vercel](https://vercel.com) — serverless functions, automatic HTTPS |

### Chrome Extension
| Layer | Technology |
|---|---|
| Manifest | V3 |
| Compose detection | `MutationObserver` on `document.body` — watches for Gmail compose windows |
| Pixel injection | DOM `<img>` inserted into Gmail's contenteditable body before send |
| Self-open detection | Second `MutationObserver` watches reading pane for `[data-ms-pixel]` elements |
| Google proxy decode | Base64 decode of `googleusercontent.com/proxy/` URLs to extract tracking ID |
| Storage | `chrome.storage.sync` for config, `chrome.storage.local` for sent tracking IDs |
| Server sync | Fetches all user's tracking IDs from `/api/extension/sent-ids` on startup so dashboard-sent emails are also recognised as "mine" |

### Frontend
| Layer | Technology |
|---|---|
| UI | React 19, Tailwind CSS v4 |
| Design system | Custom "liquid glass" aesthetic — `backdrop-filter: blur`, `bg-white/5` layers |
| Toast | `sonner` |
| Font | Geist (variable, loaded via `next/font`) |

---

## Architecture

```
mailsuite-pro/
├── chrome-extension/          # Manifest V3 Chrome extension
│   ├── manifest.json
│   ├── content.js             # Injected into mail.google.com
│   ├── background.js          # Service worker (extension lifecycle)
│   ├── popup.html/js          # Extension popup — API key input + status
│   └── icons/
│
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── prisma.config.ts       # libSQL adapter config
│
└── src/
    ├── app/
    │   ├── api/
    │   │   ├── auth/          # NextAuth route handler
    │   │   ├── contacts/      # GET (list) contacts
    │   │   ├── emails/        # GET tracked emails for dashboard
    │   │   │   └── [id]/followup/  # POST send follow-up
    │   │   ├── extension/     # Chrome extension API
    │   │   │   ├── route.ts   # GET (key), POST (pre-register), PATCH (update on send)
    │   │   │   ├── self/      # PATCH — mark open as self
    │   │   │   └── sent-ids/  # GET — all user trackingIds for extension sync
    │   │   ├── opens/[id]/    # PATCH — "This was me" manual self-mark
    │   │   ├── resumes/       # GET, POST resume upload
    │   │   ├── send/          # POST — compose + send via Gmail API
    │   │   └── track/
    │   │       └── [trackingId]/pixel.gif/  # GET — fires tracking pixel
    │   │
    │   ├── dashboard/
    │   │   ├── compose/       # Compose page (UI + follow-up config)
    │   │   ├── contacts/      # Contact list
    │   │   ├── resumes/       # Resume upload/management
    │   │   ├── settings/      # Extension key display
    │   │   └── tracking/      # Real-time open dashboard
    │   │
    │   └── login/             # Google OAuth sign-in page
    │
    └── lib/
        ├── auth.ts            # NextAuth config
        ├── gmail.ts           # Gmail API — send, profile, OAuth token refresh
        ├── prisma.ts          # Prisma singleton (handles libSQL vs file:// URLs)
        ├── tracking.ts        # IP geo + UA parsing, self-open detection
        └── utils.ts           # cn() helper
```

---

## Data model

```prisma
model Email {
  trackingId   String    @unique @default(cuid())
  toEmail      String?   // raw recipient (denormalised for display)
  subject      String
  body         String
  status       String    // pending | sent | failed
  senderIp     String?   // used for IP-based self-open detection
  openedAt     DateTime? // first non-self open
  openCount    Int       @default(0)
  followUpMode String?   // auto | manual | none
  followUpDays Int?
  ...
  contact      Contact?  // resolved contact (may be null for extension-sent emails)
  opens        EmailOpen[]
  resume       Resume?
}

model EmailOpen {
  ip       String?
  city     String?
  country  String?
  device   String?   // mobile | desktop | tablet
  os       String?   // iOS | macOS | Windows | Android | Linux
  browser  String?   // Chrome | Safari | Gmail | ...
  isSelf   Boolean   @default(false)
  openedAt DateTime  @default(now())
}
```

---

## How tracking works

### Sending from the dashboard
1. User fills in compose form, hits **Send Email**
2. `/api/send` creates an `Email` record (status `pending`), calls Gmail API to send
3. The email HTML body contains a `<img src="/api/track/{trackingId}/pixel.gif">` tag
4. On success, record is updated to `status: sent`

### Sending from Gmail (extension)
1. User opens Gmail compose — extension `MutationObserver` fires
2. Extension calls `POST /api/extension` to pre-register an email record → gets back `trackingId` + `pixelUrl`
3. Extension injects `<img data-ms-pixel="1" src="{pixelUrl}">` into the compose body immediately
4. On send click, extension calls `PATCH /api/extension` with the actual `to` + `subject` to update the record
5. Extension stores the `trackingId` → `sentAt` pair in `chrome.storage.local`

### When someone opens the email
1. Email client loads the tracking pixel → `GET /api/track/{trackingId}/pixel.gif`
2. Server reads IP from `x-forwarded-for`, parses UA string, calls `ip-api.com` for geo
3. Creates `EmailOpen` record with device/location data
4. If IP matches sender IP → `isSelf: true`, openCount not incremented
5. Returns a 1×1 transparent GIF with `Cache-Control: no-store`
6. Dashboard polling picks it up within 15 seconds

### Gmail proxy
Gmail routes **all** image loads through `ci3.googleusercontent.com` proxy servers. This means:
- Every open shows location as Google's data center (Mountain View CA or Denver CO)
- Device/OS info reflects Google's proxy, not the recipient
- The dashboard labels these as "Gmail (proxy)" and shows an info banner
- When all opens are via proxy, an "⚠ Open status may be unreliable" badge appears

### Self-open detection (extension)
When you open your own sent email in Gmail:
1. Extension `MutationObserver` sees `[data-ms-pixel="1"]` appear in the reading pane
2. Tries to extract `trackingId` from the `src` attribute directly
3. If Gmail rewrote it to a proxy URL — attempts base64 decode of the proxy path
4. If still no match — uses the most recently sent email from the last 2 minutes
5. If trackingId is in `sentEmails` map → calls `PATCH /api/extension/self` to mark the open as self

The extension syncs all user trackingIds from `/api/extension/sent-ids` on startup and every 5 minutes, so dashboard-sent emails are also recognised as self-opens when you open them in Gmail.

---

## Setting up locally

### Prerequisites
- Node.js 20+
- A Google Cloud project with Gmail API + Google OAuth enabled
- A Turso account (free tier works) or just use local SQLite for dev

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/mailsuite-pro.git
cd mailsuite-pro
npm install
```

### 2. Environment variables

Create `.env.local`:

```env
# NextAuth
AUTH_SECRET=<generate with: openssl rand -base64 32>
AUTH_URL=http://localhost:3001

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret

# Database — use either:
DATABASE_URL=file:./dev.db                          # local SQLite (dev)
DATABASE_URL=libsql://your-db.turso.io              # Turso (prod)
TURSO_AUTH_TOKEN=your_turso_jwt                     # only needed for Turso

# App URL (used for pixel URLs in emails)
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

### 3. Google Cloud setup
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → **APIs & Services** → enable **Gmail API**
3. **OAuth consent screen** → External → add your email as test user
4. **Credentials** → Create OAuth 2.0 Client ID → Web application
5. Add authorized redirect URIs:
   - `http://localhost:3001/api/auth/callback/google`
   - `https://yourdomain.vercel.app/api/auth/callback/google`

### 4. Database setup

**Local SQLite:**
```bash
npx prisma db push
```

**Turso:**
```bash
# Install Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Create DB and get credentials
turso db create mailsuite-pro
turso db show mailsuite-pro --url
turso db tokens create mailsuite-pro

# Apply schema (generate SQL first, then pipe to Turso)
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migration.sql
turso db shell mailsuite-pro < migration.sql
```

### 5. Run

```bash
npm run dev
# → http://localhost:3001
```

---

## Chrome extension setup

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the `chrome-extension/` folder
4. Sign in to [mailsuite-pro.vercel.app](https://mailsuite-pro.vercel.app) (or localhost)
5. Go to **Settings** → copy your Extension API Key
6. Click the MailSuite extension icon → paste key + dashboard URL → **Save**
7. Open Gmail — you'll see "● Tracking ON" badge in compose windows

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel login

# Set env vars (use printf to avoid trailing newlines on secrets)
printf '%s' "your_auth_secret"       | vercel env add AUTH_SECRET production
printf '%s' "your_turso_token"       | vercel env add TURSO_AUTH_TOKEN production
vercel env add DATABASE_URL production        # paste libsql:// URL interactively
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add AUTH_URL production            # https://yourdomain.vercel.app
vercel env add NEXT_PUBLIC_APP_URL production

vercel deploy --prod
```

> **Important:** Use `printf '%s'` not `echo` when piping secrets — `echo` adds a trailing newline that corrupts JWTs and OAuth secrets, causing 401 errors.

---

## API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/emails` | Session | List all tracked emails with opens |
| `POST` | `/api/send` | Session | Compose + send via Gmail API |
| `GET` | `/api/contacts` | Session | List contacts |
| `GET` | `/api/resumes` | Session | List uploaded resumes |
| `POST` | `/api/resumes` | Session | Upload a resume PDF |
| `GET` | `/api/track/[id]/pixel.gif` | None | Tracking pixel — records open |
| `GET` | `/api/extension` | Extension key | Get/generate API key |
| `POST` | `/api/extension` | Extension key | Pre-register email on compose open |
| `PATCH` | `/api/extension` | Extension key | Update email with real to/subject on send |
| `PATCH` | `/api/extension/self` | Extension key | Mark most recent open as self |
| `GET` | `/api/extension/sent-ids` | Extension key | Get all trackingIds for extension sync |
| `PATCH` | `/api/opens/[id]` | Session | "This was me" — manually mark open as self |
| `POST` | `/api/emails/[id]/followup` | Session | Send follow-up email |

---

## Known limitations

- **Gmail proxy** — All Gmail image loads go through Google's servers, so device/location info for Gmail opens is always Google's proxy (Mountain View CA or Denver CO), not the recipient's actual location. This is a Gmail platform constraint and cannot be worked around without the recipient installing software.
- **iOS self-opens** — The Chrome extension only runs on desktop Chrome/Chromium. If you open your own email on an iPhone, it won't be auto-detected as a self-open. Use "This was me ×" to exclude it manually.
- **Image blocking** — Recipients who block remote images in their email client will never fire the pixel. This is standard for all email tracking tools.
- **Turso free tier** — 500 databases, 1 GB storage, 1 billion row reads/month. More than enough for personal use.
- **Google OAuth test mode** — While the app is in "testing" on Google Cloud, only explicitly added test users can sign in. To open it up, submit for OAuth verification.

---

## License

MIT
