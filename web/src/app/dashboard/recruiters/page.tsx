"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { toast } from "sonner"
import Link from "next/link"

type Outreach = {
  id: string
  channel: string
  status: string
  sentAt: string | null
  messageText: string | null
}

type Recruiter = {
  id: string
  name: string
  title: string | null
  company: string
  linkedinUrl: string
  email: string | null
  emailSource: string | null
  relevanceScore: number | null
  createdAt: string
  outreach: Outreach[]
}

type CompanyGroup = {
  company: string
  recruiters: Recruiter[]
}

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

const CHANNEL_LABEL: Record<string, string> = {
  email:               "Email",
  linkedin_connection: "LI Connection",
  linkedin_inmail:     "LI InMail",
  linkedin_dm:         "LI DM",
}

export default function RecruitersPage() {
  const [recruiters, setRecruiters] = useState<Recruiter[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState("")
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [approving, setApproving]   = useState<Set<string>>(new Set())

  const fetchRecruiters = useCallback(async () => {
    try {
      const res = await fetch("/api/recruiters")
      if (res.ok) {
        const data = await res.json() as { recruiters: Recruiter[] }
        setRecruiters(data.recruiters)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRecruiters()
    const t = setInterval(fetchRecruiters, 60_000)
    return () => clearInterval(t)
  }, [fetchRecruiters])

  const stats = useMemo(() => {
    const all = recruiters.flatMap(r => r.outreach)
    return {
      total:          recruiters.length,
      emailsSent:     all.filter(o => o.channel === "email" && o.status === "sent").length,
      linkedinQueued: all.filter(o => o.channel.startsWith("linkedin") && o.status === "queued").length,
      linkedinSent:   all.filter(o => o.channel.startsWith("linkedin") && o.status === "sent").length,
    }
  }, [recruiters])

  const groups = useMemo((): CompanyGroup[] => {
    const map = new Map<string, Recruiter[]>()
    for (const r of recruiters) {
      const arr = map.get(r.company) ?? []
      arr.push(r)
      map.set(r.company, arr)
    }
    return Array.from(map.entries())
      .map(([company, recs]) => ({
        company,
        recruiters: [...recs].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)),
      }))
      .sort((a, b) => a.company.localeCompare(b.company))
  }, [recruiters])

  const filteredGroups = useMemo((): CompanyGroup[] => {
    const term = search.toLowerCase().trim()
    if (!term) return groups
    return groups
      .map(group => {
        if (group.company.toLowerCase().includes(term)) return group
        const filtered = group.recruiters.filter(r =>
          r.name.toLowerCase().includes(term)
        )
        return filtered.length > 0 ? { ...group, recruiters: filtered } : null
      })
      .filter((g): g is CompanyGroup => g !== null)
  }, [groups, search])

  const handleApproveLinkedin = async (recruiter: Recruiter) => {
    const queued = recruiter.outreach.filter(
      o => o.channel.startsWith("linkedin") && o.status === "queued"
    )
    if (queued.length === 0) return
    const ids = queued.map(o => o.id)
    setApproving(prev => new Set([...prev, ...ids]))
    try {
      await Promise.allSettled(
        ids.map(id => fetch(`/api/outreach/approve/${id}`, { method: "POST" }))
      )
      setRecruiters(prev =>
        prev.map(r =>
          r.id !== recruiter.id
            ? r
            : {
                ...r,
                outreach: r.outreach.map(o =>
                  ids.includes(o.id) ? { ...o, status: "approved" } : o
                ),
              }
        )
      )
      toast.success("LinkedIn outreach approved", { description: recruiter.name })
    } catch {
      toast.error("Failed to approve outreach")
    } finally {
      setApproving(prev => {
        const n = new Set(prev)
        ids.forEach(id => n.delete(id))
        return n
      })
    }
  }

  const handleQueueOutreach = async (company: string) => {
    try {
      const res = await fetch("/api/recruiters/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company }),
      })
      if (!res.ok) throw new Error()
      toast.success("Recruiter search triggered", { description: company })
    } catch {
      toast.error("Failed to trigger recruiter search")
    }
  }

  return (
    <>
      <style>{`
        @keyframes recRowIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="p-8 max-w-5xl">
        {/* Header */}
        <div className="mb-7">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Recruiter Outreach</h1>
            {!loading && <span className="stat-badge">{recruiters.length}</span>}
          </div>
          <p className="text-white/40 text-sm mt-1">
            Manage recruiter contacts and LinkedIn outreach queue.
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
          <StatCard label="Recruiters Found" value={stats.total}          accent="white" />
          <StatCard label="Emails Sent"       value={stats.emailsSent}     accent="green" />
          <StatCard label="LinkedIn Queued"   value={stats.linkedinQueued} accent="amber" />
          <StatCard label="LinkedIn Sent"     value={stats.linkedinSent}   accent="blue"  />
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by company or recruiter name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="glass-input w-full px-4 py-2.5 text-sm"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="glass-card p-5 animate-pulse">
                <div className="flex gap-4 items-center">
                  <div className="w-16 h-5 rounded-md bg-white/8 shrink-0" />
                  <div className="flex-1 space-y-2.5">
                    <div className="h-4 bg-white/8 rounded-md w-2/5" />
                    <div className="h-3 bg-white/5 rounded-md w-1/4" />
                  </div>
                  <div className="h-8 w-28 bg-white/5 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <div className="text-5xl mb-4 opacity-20 select-none">◒</div>
            <div className="text-white/40 text-sm">
              {search
                ? "No recruiters match your search."
                : "No recruiters found yet. Approve jobs to trigger recruiter search."}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredGroups.map((group, gIdx) => (
              <CompanySection
                key={group.company}
                group={group}
                gIdx={gIdx}
                expanded={expanded}
                approving={approving}
                onToggle={id => setExpanded(expanded === id ? null : id)}
                onApproveLinkedin={handleApproveLinkedin}
                onQueueOutreach={handleQueueOutreach}
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
  accent: "white" | "green" | "amber" | "blue"
}) {
  const numStyle = {
    white: "text-white",
    green: "text-emerald-300",
    amber: "text-amber-300",
    blue:  "text-blue-300",
  }[accent]

  return (
    <div className="glass-card p-4">
      <div className="text-white/40 text-xs font-medium mb-2">{label}</div>
      <div className={`text-3xl font-bold ${numStyle}`}>{value}</div>
    </div>
  )
}

function CompanySection({
  group,
  gIdx,
  expanded,
  approving,
  onToggle,
  onApproveLinkedin,
  onQueueOutreach,
}: {
  group: CompanyGroup
  gIdx: number
  expanded: string | null
  approving: Set<string>
  onToggle: (id: string) => void
  onApproveLinkedin: (r: Recruiter) => void
  onQueueOutreach: (company: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-white/60 text-xs uppercase tracking-widest font-semibold whitespace-nowrap">
          {group.company}
        </span>
        <span className="stat-badge">{group.recruiters.length}</span>
        <div className="flex-1 h-px bg-white/8" />
      </div>

      <div className="space-y-2">
        {group.recruiters.map((recruiter, idx) => (
          <RecruiterCard
            key={recruiter.id}
            recruiter={recruiter}
            animIdx={Math.min(gIdx * 8 + idx, 14)}
            expanded={expanded === recruiter.id}
            approving={approving}
            onToggle={() => onToggle(recruiter.id)}
            onApproveLinkedin={onApproveLinkedin}
            onQueueOutreach={onQueueOutreach}
          />
        ))}
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null
  if (score >= 70) return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-md border bg-emerald-500/15 text-emerald-300 border-emerald-500/28 whitespace-nowrap">
      Campus · {score}
    </span>
  )
  if (score >= 40) return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-md border bg-amber-500/15 text-amber-300 border-amber-500/28 whitespace-nowrap">
      Technical · {score}
    </span>
  )
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-md border bg-white/8 text-white/40 border-white/12 whitespace-nowrap">
      General · {score}
    </span>
  )
}

function OutreachStatusRow({ outreach }: { outreach: Outreach[] }) {
  const CHANNELS = ["email", "linkedin_connection", "linkedin_inmail", "linkedin_dm"] as const
  const present = CHANNELS.filter(ch => outreach.some(o => o.channel === ch))

  if (present.length === 0) {
    return <span className="text-white/20 text-xs">No outreach yet</span>
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {present.map(channel => {
        const item = outreach.find(o => o.channel === channel)!
        const isEmail = channel === "email"
        const dotColor =
          item.status === "sent"
            ? isEmail ? "bg-emerald-400" : "bg-blue-400"
            : item.status === "queued" || item.status === "approved"
            ? "bg-amber-400"
            : item.status === "failed"
            ? "bg-red-400"
            : "bg-white/20"
        const statusColor =
          item.status === "sent"     ? "text-white/35" :
          item.status === "queued"   ? "text-amber-300/60" :
          item.status === "approved" ? "text-blue-300/60" :
          "text-red-300/60"

        return (
          <div key={channel} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
            <span className="text-white/40 text-xs">{CHANNEL_LABEL[channel]}</span>
            <span className={`text-xs ${statusColor}`}>{item.status}</span>
          </div>
        )
      })}
    </div>
  )
}

function RecruiterCard({
  recruiter,
  animIdx,
  expanded,
  approving,
  onToggle,
  onApproveLinkedin,
  onQueueOutreach,
}: {
  recruiter: Recruiter
  animIdx: number
  expanded: boolean
  approving: Set<string>
  onToggle: () => void
  onApproveLinkedin: (r: Recruiter) => void
  onQueueOutreach: (company: string) => void
}) {
  const { outreach } = recruiter
  const hasNoOutreach   = outreach.length === 0
  const queuedLinkedin  = outreach.filter(o => o.channel.startsWith("linkedin") && o.status === "queued")
  const hasEmailSent    = outreach.some(o => o.channel === "email" && o.status === "sent")
  const allSent         = outreach.length > 0 && outreach.every(o => o.status === "sent")
  const isApproving     = queuedLinkedin.some(o => approving.has(o.id))

  const emailSourceStyle =
    recruiter.emailSource === "apollo" ? "bg-purple-500/15 text-purple-300 border-purple-500/25" :
    recruiter.emailSource === "hunter" ? "bg-orange-500/15 text-orange-300 border-orange-500/25" :
    recruiter.emailSource === "both"   ? "bg-blue-500/15 text-blue-300 border-blue-500/25" :
    "bg-white/8 text-white/40 border-white/12"

  return (
    <div
      className="glass-card overflow-hidden"
      style={{
        animation: `recRowIn 0.3s ease forwards`,
        animationDelay: `${animIdx * 35}ms`,
        opacity: 0,
      }}
    >
      <button
        onClick={onToggle}
        className="w-full p-4 flex gap-3 items-start text-left hover:bg-white/5 transition-colors duration-150"
      >
        {/* Score badge */}
        <div className="shrink-0 pt-0.5">
          <ScoreBadge score={recruiter.relevanceScore} />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-white font-semibold text-sm">{recruiter.name}</span>
          </div>
          {recruiter.title && (
            <div className="text-white/45 text-xs mb-2">{recruiter.title}</div>
          )}

          <div className="flex items-center gap-3 text-xs mb-3 flex-wrap">
            <a
              href={recruiter.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-blue-400/60 hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              <span>🔗</span>
              <span>LinkedIn ↗</span>
            </a>
            {recruiter.email && (
              <span className="flex items-center gap-1.5 text-white/45">
                <span>✉</span>
                <span className="truncate max-w-[200px]">{recruiter.email}</span>
                {recruiter.emailSource && (
                  <span className={`px-1.5 py-0.5 rounded border text-xs font-medium ${emailSourceStyle}`}>
                    {recruiter.emailSource}
                  </span>
                )}
              </span>
            )}
          </div>

          <OutreachStatusRow outreach={outreach} />
        </div>

        {/* Action buttons */}
        <div
          className="flex items-center gap-2 shrink-0 flex-wrap justify-end"
          onClick={e => e.stopPropagation()}
        >
          {allSent && queuedLinkedin.length === 0 ? (
            <span className="text-xs font-semibold px-3 py-1.5 rounded-xl border bg-emerald-500/12 text-emerald-300 border-emerald-500/25">
              ✓ Contacted
            </span>
          ) : (
            <>
              {hasNoOutreach && (
                <button
                  onClick={() => onQueueOutreach(recruiter.company)}
                  className="text-xs px-3 py-1.5 font-semibold rounded-xl transition-all duration-150
                    bg-purple-500/18 text-purple-300 border border-purple-500/28
                    hover:bg-purple-500/28 hover:text-purple-200 hover:-translate-y-px"
                >
                  Queue Outreach
                </button>
              )}
              {queuedLinkedin.length > 0 && (
                <button
                  disabled={isApproving}
                  onClick={() => onApproveLinkedin(recruiter)}
                  className="text-xs px-3 py-1.5 font-semibold rounded-xl transition-all duration-150 disabled:opacity-40
                    bg-amber-500/18 text-amber-300 border border-amber-500/28
                    hover:bg-amber-500/28 hover:text-amber-200 hover:-translate-y-px"
                >
                  {isApproving ? "Approving…" : "Approve LinkedIn"}
                </button>
              )}
              {!hasEmailSent && recruiter.email && !hasNoOutreach && (
                <Link
                  href="/dashboard/compose"
                  onClick={e => e.stopPropagation()}
                  className="text-xs px-3 py-1.5 font-semibold rounded-xl transition-all duration-150
                    bg-blue-500/18 text-blue-300 border border-blue-500/28
                    hover:bg-blue-500/28 hover:text-blue-200 hover:-translate-y-px"
                >
                  Send Email
                </Link>
              )}
            </>
          )}
          <span className="text-white/20 text-xs select-none ml-1">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded section */}
      {expanded && outreach.length > 0 && (
        <div className="border-t border-white/8 p-4">
          <div className="text-white/40 text-xs font-medium mb-3 uppercase tracking-wide">
            Outreach Messages
          </div>
          <div className="space-y-2">
            {outreach.map(item => (
              <div
                key={item.id}
                className="flex gap-3 p-3 rounded-xl border border-white/6"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-white/70 text-xs font-medium">
                      {CHANNEL_LABEL[item.channel] ?? item.channel}
                    </span>
                    <span className={`text-xs ${
                      item.status === "sent"     ? "text-emerald-300" :
                      item.status === "queued"   ? "text-amber-300" :
                      item.status === "approved" ? "text-blue-300" :
                      "text-red-300"
                    }`}>
                      {item.status}
                    </span>
                  </div>
                  {item.messageText && (
                    <p className="text-white/35 text-xs leading-relaxed">
                      {item.messageText.length > 100
                        ? item.messageText.slice(0, 100) + "…"
                        : item.messageText}
                    </p>
                  )}
                </div>
                {item.sentAt && (
                  <div className="text-white/25 text-xs shrink-0 mt-0.5">{timeAgo(item.sentAt)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
