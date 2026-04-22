"use client"

import { useState, useEffect, useCallback } from "react"

type RecruiterOutreach = {
  id: string
  channel: string
  status: string
  sentAt: string | null
  messageText: string | null
  recruiter: {
    name: string
    title: string | null
  }
}

type Application = {
  id: string
  status: string
  portalEmail: string | null
  resumeVersion: string | null
  createdAt: string
  job: {
    title: string
    company: string
    location: string | null
    source: string
    jobBoardUrl: string
    isTopPriority: boolean
  }
  recruiterOutreach: RecruiterOutreach[]
}

type AppFilter = "all" | "submitted" | "pending_review" | "failed"

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const SOURCE_STYLE: Record<string, string> = {
  linkedin:   "bg-blue-500/15 text-blue-300 border-blue-500/25",
  instagram:  "bg-pink-500/15 text-pink-300 border-pink-500/25",
  jobspy:     "bg-purple-500/15 text-purple-300 border-purple-500/25",
  greenhouse: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  lever:      "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  handshake:  "bg-orange-500/15 text-orange-300 border-orange-500/25",
}

function sourceStyle(source: string) {
  return SOURCE_STYLE[source.toLowerCase()] ?? "bg-white/8 text-white/50 border-white/12"
}

const STATUS_STYLE: Record<string, string> = {
  submitted:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/28",
  pending_review: "bg-amber-500/15 text-amber-300 border-amber-500/28",
  failed:         "bg-red-500/15 text-red-300 border-red-500/28",
}

const STATUS_LABEL: Record<string, string> = {
  submitted:      "Submitted",
  pending_review: "In Review",
  failed:         "Failed",
}

const APP_FILTERS: { id: AppFilter; label: string }[] = [
  { id: "all",            label: "All" },
  { id: "submitted",      label: "Submitted" },
  { id: "pending_review", label: "In Review" },
  { id: "failed",         label: "Failed" },
]

const CHANNEL_LABEL: Record<string, string> = {
  email:               "Email",
  linkedin_connection: "LinkedIn Connection",
  linkedin_inmail:     "LinkedIn InMail",
  linkedin_dm:         "LinkedIn DM",
}

const OUTREACH_STATUS_STYLE: Record<string, string> = {
  sent:     "text-emerald-300",
  queued:   "text-amber-300",
  failed:   "text-red-300",
  approved: "text-blue-300",
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading]           = useState(true)
  const [filter, setFilter]             = useState<AppFilter>("all")
  const [expanded, setExpanded]         = useState<string | null>(null)

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch("/api/applications")
      if (res.ok) {
        const data = await res.json() as { applications: Application[] }
        setApplications(data.applications)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchApplications()
    const t = setInterval(fetchApplications, 60_000)
    return () => clearInterval(t)
  }, [fetchApplications])

  const filtered = applications.filter(a =>
    filter === "all" ? true : a.status === filter
  )

  const counts = {
    total:          applications.length,
    submitted:      applications.filter(a => a.status === "submitted").length,
    pending_review: applications.filter(a => a.status === "pending_review").length,
    failed:         applications.filter(a => a.status === "failed").length,
  }

  return (
    <>
      <style>{`
        @keyframes appRowIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="p-8 max-w-5xl">
        {/* Header */}
        <div className="mb-7">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Applications</h1>
            {!loading && (
              <span className="stat-badge">{applications.length}</span>
            )}
          </div>
          <p className="text-white/40 text-sm mt-1">
            Track all submitted job applications and recruiter outreach.
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          <StatCard label="Total Applied"  value={counts.total}          accent="white" />
          <StatCard label="Submitted"      value={counts.submitted}      accent="green" />
          <StatCard label="In Review"      value={counts.pending_review} accent="amber" />
          <StatCard label="Failed"         value={counts.failed}         accent="red"   />
        </div>

        {/* Filter bar */}
        <div className="flex gap-0.5 mb-6 p-1 rounded-xl glass w-fit flex-wrap">
          {APP_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                filter === id
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="glass-card p-5 animate-pulse">
                <div className="flex gap-4 items-center">
                  <div className="w-10 h-10 rounded-xl bg-white/8 shrink-0" />
                  <div className="flex-1 space-y-2.5">
                    <div className="h-4 bg-white/8 rounded-md w-2/5" />
                    <div className="h-3 bg-white/5 rounded-md w-1/4" />
                  </div>
                  <div className="h-6 w-20 bg-white/5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <div className="text-5xl mb-4 opacity-20 select-none">◎</div>
            <div className="text-white/40 text-sm">
              {filter === "all"
                ? "No applications yet. Approve jobs from the queue to start applying."
                : `No ${STATUS_LABEL[filter] ?? filter} applications.`}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((app, idx) => (
              <ApplicationRow
                key={app.id}
                app={app}
                idx={idx}
                expanded={expanded === app.id}
                onToggle={() => setExpanded(expanded === app.id ? null : app.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: "white" | "green" | "amber" | "red"
}) {
  const numStyle = {
    white: "text-white",
    green: "text-emerald-300",
    amber: "text-amber-300",
    red:   "text-red-300",
  }[accent]

  return (
    <div className="glass-card p-4">
      <div className="text-white/40 text-xs font-medium mb-2">{label}</div>
      <div className={`text-3xl font-bold ${numStyle}`}>{value}</div>
    </div>
  )
}

function OutreachIndicators({ outreach }: { outreach: RecruiterOutreach[] }) {
  const emailItems    = outreach.filter(o => o.channel === "email")
  const linkedinItems = outreach.filter(o => o.channel.startsWith("linkedin"))

  if (emailItems.length === 0 && linkedinItems.length === 0) {
    return <span className="text-white/20 text-xs">—</span>
  }

  const dotColor = (status: string, type: "email" | "linkedin") => {
    if (status === "sent")   return type === "email" ? "bg-emerald-400" : "bg-blue-400"
    if (status === "queued") return "bg-amber-400 opacity-50"
    if (status === "failed") return "bg-red-400"
    return "bg-white/20"
  }

  return (
    <div className="flex items-center gap-2">
      {emailItems.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">✉</span>
          <div className={`w-2 h-2 rounded-full ${dotColor(emailItems[0].status, "email")}`} />
        </div>
      )}
      {linkedinItems.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/40">🔗</span>
          <div className={`w-2 h-2 rounded-full ${dotColor(linkedinItems[0].status, "linkedin")}`} />
        </div>
      )}
    </div>
  )
}

function ApplicationRow({
  app,
  idx,
  expanded,
  onToggle,
}: {
  app: Application
  idx: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      className="glass-card overflow-hidden"
      style={{
        animation: `appRowIn 0.3s ease forwards`,
        animationDelay: `${idx * 40}ms`,
        opacity: 0,
        ...(app.job.isTopPriority
          ? { borderColor: "rgba(251,191,36,0.28)", backgroundColor: "rgba(251,191,36,0.04)" }
          : {}),
      }}
    >
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex gap-3 items-start text-left hover:bg-white/5 transition-colors duration-150"
      >
        {/* Company initial */}
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 select-none ${
            app.job.isTopPriority
              ? "bg-amber-400/15 text-amber-300"
              : "bg-white/8 text-white/45"
          }`}
        >
          {app.job.company[0]?.toUpperCase() ?? "?"}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {app.job.isTopPriority && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md border bg-amber-400/12 text-amber-300 border-amber-400/28 whitespace-nowrap">
                ⭐ Priority
              </span>
            )}
            <span className="text-white font-semibold text-sm leading-snug">
              {app.job.title}
            </span>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap text-xs text-white/50">
            <span className="font-medium text-white/65">{app.job.company}</span>
            {app.job.location && (
              <span className="flex items-center gap-1">
                <span className="opacity-60">⚲</span>
                {app.job.location}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-md border font-medium ${sourceStyle(app.job.source)}`}>
              {app.job.source}
            </span>
            <span className="text-white/28">{timeAgo(app.createdAt)}</span>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 shrink-0">
          <OutreachIndicators outreach={app.recruiterOutreach} />
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
              STATUS_STYLE[app.status] ?? "bg-white/8 text-white/50 border-white/12"
            }`}
          >
            {STATUS_LABEL[app.status] ?? app.status}
          </span>
          <a
            href={app.job.jobBoardUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5"
          >
            View ↗
          </a>
          <span className="text-white/20 text-xs select-none">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="border-t border-white/8 p-4">
          <div className="text-white/40 text-xs font-medium mb-3 uppercase tracking-wide">
            Recruiter Outreach History
          </div>

          {app.recruiterOutreach.length === 0 ? (
            <p className="text-white/25 text-xs italic">No outreach sent yet.</p>
          ) : (
            <div className="space-y-2">
              {app.recruiterOutreach.map(outreach => (
                <OutreachItem key={outreach.id} outreach={outreach} />
              ))}
            </div>
          )}

          {app.resumeVersion && (
            <div className="mt-4 pt-3 border-t border-white/8">
              <a
                href={app.resumeVersion}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost text-xs px-3 py-1.5 font-medium inline-flex items-center gap-1.5"
              >
                View Resume ↗
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OutreachItem({ outreach }: { outreach: RecruiterOutreach }) {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-white/6" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-white/70 text-xs font-medium">
            {CHANNEL_LABEL[outreach.channel] ?? outreach.channel}
          </span>
          {outreach.recruiter?.name && (
            <span className="text-white/35 text-xs">
              → {outreach.recruiter.name}
              {outreach.recruiter.title && (
                <span className="text-white/25"> · {outreach.recruiter.title}</span>
              )}
            </span>
          )}
        </div>
        {outreach.messageText && (
          <p className="text-white/35 text-xs leading-relaxed">
            {outreach.messageText.length > 100
              ? outreach.messageText.slice(0, 100) + "…"
              : outreach.messageText}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className={`text-xs font-medium ${OUTREACH_STATUS_STYLE[outreach.status] ?? "text-white/40"}`}>
          {outreach.status}
        </div>
        {outreach.sentAt && (
          <div className="text-white/25 text-xs mt-0.5">{timeAgo(outreach.sentAt)}</div>
        )}
      </div>
    </div>
  )
}
