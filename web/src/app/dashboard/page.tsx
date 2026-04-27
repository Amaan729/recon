"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

type DashboardStats = {
  pending: number
  submitted: number
  outreachToday: number
  activePipeline: number
}

type AgentStatus = "idle" | "running" | "error"

type AgentStatusResponse = {
  status: AgentStatus
  lastRunAt: string | null
}

type PendingJob = {
  id: string
  title: string
  company: string
  location: string | null
  jobBoardUrl: string
  source: string
  status: string
  isTopPriority: boolean
  matchScore: number | null
  createdAt: string
}

type RecentApplication = {
  id: string
  status: string
  createdAt: string
  submittedAt: string | null
  job: {
    title: string
    company: string
    location: string | null
    source: string
    jobBoardUrl: string
    isTopPriority: boolean
  }
}

const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "")

const SOURCE_STYLE: Record<string, string> = {
  linkedin:   "bg-blue-500/15 text-blue-300 border-blue-500/25",
  instagram:  "bg-pink-500/15 text-pink-300 border-pink-500/25",
  jobspy:     "bg-purple-500/15 text-purple-300 border-purple-500/25",
  greenhouse: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  lever:      "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  handshake:  "bg-orange-500/15 text-orange-300 border-orange-500/25",
}

const APPLICATION_STATUS_STYLE: Record<string, string> = {
  submitted:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/28",
  pending_review: "bg-amber-500/15 text-amber-300 border-amber-500/28",
  failed:         "bg-red-500/15 text-red-300 border-red-500/28",
}

const APPLICATION_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  pending_review: "In Review",
  failed: "Failed",
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

function sourceStyle(source: string) {
  return SOURCE_STYLE[source.toLowerCase()] ?? "bg-white/8 text-white/50 border-white/12"
}

function formatLastRun(lastRunAt: string | null): string {
  if (!lastRunAt) return "Never"
  const date = new Date(lastRunAt)
  return `${date.toLocaleString()} · ${timeAgo(lastRunAt)}`
}

async function fetchAgentJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    throw new Error(`Request failed for ${path}`)
  }

  return await res.json() as T
}

export default function DashboardHomePage() {
  const [stats, setStats] = useState<DashboardStats>({
    pending: 0,
    submitted: 0,
    outreachToday: 0,
    activePipeline: 0,
  })
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([])
  const [applications, setApplications] = useState<RecentApplication[]>([])
  const [agent, setAgent] = useState<AgentStatusResponse>({
    status: "idle",
    lastRunAt: null,
  })
  const [loading, setLoading] = useState(true)
  const [actingOnJobs, setActingOnJobs] = useState<Set<string>>(new Set())
  const [startingAgent, setStartingAgent] = useState(false)

  const fetchStats = useCallback(async () => {
    const data = await fetchAgentJson<DashboardStats>("/dashboard/stats")
    setStats(data)
  }, [])

  const fetchPendingJobs = useCallback(async () => {
    const data = await fetchAgentJson<{ jobs: PendingJob[] }>("/jobs/queue")
    setPendingJobs(data.jobs)
  }, [])

  const fetchRecentApplications = useCallback(async () => {
    const data = await fetchAgentJson<{ applications: RecentApplication[] }>("/applications/recent")
    setApplications(data.applications)
  }, [])

  const fetchAgentStatus = useCallback(async () => {
    try {
      const data = await fetchAgentJson<AgentStatusResponse>("/agent/status")
      setAgent({
        status: data.status,
        lastRunAt: data.lastRunAt,
      })
    } catch {
      setAgent(prev => ({ ...prev, status: "error" }))
    }
  }, [])

  const fetchOverview = useCallback(async () => {
    try {
      await Promise.all([
        fetchStats(),
        fetchPendingJobs(),
        fetchRecentApplications(),
        fetchAgentStatus(),
      ])
    } catch {
      toast.error("Failed to load dashboard overview")
    } finally {
      setLoading(false)
    }
  }, [fetchAgentStatus, fetchPendingJobs, fetchRecentApplications, fetchStats])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void fetchOverview()
    }, 0)
    return () => clearTimeout(t)
  }, [fetchOverview])

  useEffect(() => {
    const t = setInterval(fetchAgentStatus, 10_000)
    return () => clearInterval(t)
  }, [fetchAgentStatus])

  const handleJobAction = async (job: PendingJob, action: "approve" | "skip") => {
    setActingOnJobs(prev => new Set([...prev, job.id]))
    try {
      await fetchAgentJson(`/jobs/${action}/${job.id}`, { method: "POST" })
      if (action === "approve") {
        toast.success("Approved job", {
          description: `${job.title} at ${job.company}`,
        })
      } else {
        toast("Skipped job", { description: `${job.title} at ${job.company}` })
      }
      await Promise.all([fetchPendingJobs(), fetchStats(), fetchAgentStatus()])
    } catch {
      toast.error(`Failed to ${action} job`)
    } finally {
      setActingOnJobs(prev => {
        const next = new Set(prev)
        next.delete(job.id)
        return next
      })
    }
  }

  const handleStartAgent = async () => {
    setStartingAgent(true)
    try {
      await fetchAgentJson("/agent/start", { method: "POST" })
      toast.success("Agent started")
      await fetchAgentStatus()
    } catch {
      toast.error("Failed to start agent")
    } finally {
      setStartingAgent(false)
    }
  }

  const topPendingJobs = [...pendingJobs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  const recentApplications = [...applications].slice(0, 5)

  return (
    <>
      <style>{`
        @keyframes statusPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>

      <div className="p-8 max-w-7xl space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              {!loading && <span className="stat-badge">Overview</span>}
            </div>
            <p className="text-white/40 text-sm mt-1">
              Monitor your pipeline, approve jobs, and keep the agent moving.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="Pending Jobs" value={stats.pending} accent="text-white" loading={loading} />
          <StatCard label="Applications Sent" value={stats.submitted} accent="text-emerald-300" loading={loading} />
          <StatCard label="Outreach Today" value={stats.outreachToday} accent="text-blue-300" loading={loading} />
          <StatCard label="Active Pipeline" value={stats.activePipeline} accent="text-amber-300" loading={loading} />
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    agent.status === "running"
                      ? "bg-blue-400"
                      : agent.status === "error"
                      ? "bg-red-400"
                      : "bg-emerald-400"
                  }`}
                  style={agent.status === "running" ? { animation: "statusPulse 1.4s ease-in-out infinite" } : {}}
                />
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                    agent.status === "running"
                      ? "bg-blue-500/15 text-blue-300 border-blue-500/28"
                      : agent.status === "error"
                      ? "bg-red-500/15 text-red-300 border-red-500/28"
                      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/28"
                  }`}
                >
                  {agent.status === "running"
                    ? "Running"
                    : agent.status === "error"
                    ? "Error"
                    : "Idle"}
                </span>
                <span className="text-white/55 text-sm">Recon agent status</span>
              </div>
              <div className="text-white/35 text-sm">
                Last run: <span className="text-white/55">{formatLastRun(agent.lastRunAt)}</span>
              </div>
            </div>

            <button
              onClick={handleStartAgent}
              disabled={startingAgent || agent.status === "running"}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {startingAgent ? "Starting…" : "Start Agent"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="glass-card p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-white text-lg font-semibold">Pending Jobs</div>
                <p className="text-white/35 text-sm mt-1">Top 5 most recent jobs awaiting review.</p>
              </div>
              <Link
                href="/dashboard/jobs"
                className="text-sm text-blue-400/70 hover:text-blue-400 transition-colors"
              >
                View all →
              </Link>
            </div>

            <div className="hidden md:grid grid-cols-[1.1fr_1.5fr_auto_auto_auto] gap-3 px-1 pb-2 text-[11px] uppercase tracking-widest text-white/25">
              <span>Company</span>
              <span>Role</span>
              <span>Source</span>
              <span>Posted</span>
              <span className="text-right">Priority</span>
            </div>

            {loading ? (
              <SectionSkeleton rows={5} />
            ) : topPendingJobs.length === 0 ? (
              <EmptyState message="No pending jobs right now." />
            ) : (
              <div className="space-y-2.5">
                {topPendingJobs.map(job => (
                  <PendingJobRow
                    key={job.id}
                    job={job}
                    acting={actingOnJobs.has(job.id)}
                    onApprove={() => handleJobAction(job, "approve")}
                    onSkip={() => handleJobAction(job, "skip")}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="glass-card p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-white text-lg font-semibold">Recent Applications</div>
                <p className="text-white/35 text-sm mt-1">The latest application activity across the pipeline.</p>
              </div>
              <Link
                href="/dashboard/applications"
                className="text-sm text-blue-400/70 hover:text-blue-400 transition-colors"
              >
                View all →
              </Link>
            </div>

            <div className="hidden md:grid grid-cols-[1fr_1.4fr_auto_auto] gap-3 px-1 pb-2 text-[11px] uppercase tracking-widest text-white/25">
              <span>Company</span>
              <span>Role</span>
              <span>Status</span>
              <span>Submitted</span>
            </div>

            {loading ? (
              <SectionSkeleton rows={5} />
            ) : recentApplications.length === 0 ? (
              <EmptyState message="No applications yet. Approve jobs to kick things off." />
            ) : (
              <div className="space-y-2.5">
                {recentApplications.map(application => (
                  <RecentApplicationRow key={application.id} application={application} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function StatCard({
  label,
  value,
  accent,
  loading,
}: {
  label: string
  value: number
  accent: string
  loading: boolean
}) {
  return (
    <div className="glass-card p-4">
      <div className="text-white/40 text-xs font-medium mb-2">{label}</div>
      {loading ? (
        <div className="h-8 w-16 rounded-md bg-white/8 animate-pulse" />
      ) : (
        <div className={`text-3xl font-bold ${accent}`}>{value}</div>
      )}
    </div>
  )
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }, (_, idx) => (
        <div key={idx} className="glass-card p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/8 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 rounded-md bg-white/8" />
              <div className="h-3 w-1/4 rounded-md bg-white/5" />
            </div>
            <div className="h-7 w-20 rounded-full bg-white/5 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="glass-card p-10 text-center">
      <div className="text-4xl mb-3 opacity-20 select-none">◎</div>
      <p className="text-white/35 text-sm">{message}</p>
    </div>
  )
}

function PendingJobRow({
  job,
  acting,
  onApprove,
  onSkip,
}: {
  job: PendingJob
  acting: boolean
  onApprove: () => void
  onSkip: () => void
}) {
  return (
    <div
      className="glass-card p-4 transition-all duration-200"
      style={job.isTopPriority ? { borderColor: "rgba(251,191,36,0.22)", backgroundColor: "rgba(251,191,36,0.04)" } : {}}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1.5fr_auto_auto_auto] gap-3 items-center">
        <div className="min-w-0">
          <div className="text-white/80 text-sm font-medium truncate">{job.company}</div>
          {job.location && <div className="text-white/30 text-xs mt-1 truncate">{job.location}</div>}
        </div>

        <div className="min-w-0">
          <div className="text-white text-sm font-semibold truncate">{job.title}</div>
          <a
            href={job.jobBoardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400/65 hover:text-blue-400 transition-colors mt-1 inline-block"
          >
            View posting ↗
          </a>
        </div>

        <span className={`w-fit px-2 py-0.5 rounded-md border text-xs font-medium ${sourceStyle(job.source)}`}>
          {job.source}
        </span>

        <div className="text-white/35 text-xs">{timeAgo(job.createdAt)}</div>

        <div className="flex items-center justify-between md:justify-end gap-3">
          {job.isTopPriority ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-md border bg-amber-500/20 text-amber-300 border-amber-500/30">
              Priority
            </span>
          ) : (
            <span className="text-white/20 text-xs">Standard</span>
          )}

          <div className="flex items-center gap-1.5">
            <button
              onClick={onSkip}
              disabled={acting}
              className="btn-ghost text-xs px-3 py-1.5 font-medium disabled:opacity-40"
            >
              Skip
            </button>
            <button
              onClick={onApprove}
              disabled={acting}
              className="text-xs px-3 py-1.5 font-semibold rounded-xl transition-all duration-150 disabled:opacity-40
                bg-emerald-500/18 text-emerald-300 border border-emerald-500/28
                hover:bg-emerald-500/28 hover:text-emerald-200 hover:-translate-y-px"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RecentApplicationRow({ application }: { application: RecentApplication }) {
  const submittedAt = application.submittedAt ?? application.createdAt

  return (
    <div
      className="glass-card p-4"
      style={application.job.isTopPriority ? { borderColor: "rgba(251,191,36,0.22)", backgroundColor: "rgba(251,191,36,0.04)" } : {}}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto_auto] gap-3 items-center">
        <div className="min-w-0">
          <div className="text-white/80 text-sm font-medium truncate">{application.job.company}</div>
          {application.job.location && (
            <div className="text-white/30 text-xs mt-1 truncate">{application.job.location}</div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-white text-sm font-semibold truncate">{application.job.title}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`w-fit px-2 py-0.5 rounded-md border text-xs font-medium ${sourceStyle(application.job.source)}`}>
              {application.job.source}
            </span>
            <a
              href={application.job.jobBoardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400/65 hover:text-blue-400 transition-colors"
            >
              View ↗
            </a>
          </div>
        </div>

        <span
          className={`w-fit px-2.5 py-1 rounded-full border text-xs font-medium ${
            APPLICATION_STATUS_STYLE[application.status] ?? "bg-white/8 text-white/50 border-white/12"
          }`}
        >
          {APPLICATION_STATUS_LABEL[application.status] ?? application.status}
        </span>

        <div className="text-white/35 text-xs">{timeAgo(submittedAt)}</div>
      </div>
    </div>
  )
}
