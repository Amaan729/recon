"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"

type Job = {
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

type JobsResponse = {
  jobs: Job[]
  nextCursor: string | null
}

type Filter = "all" | "priority" | "linkedin" | "jobspy" | "applied" | "skipped"

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
  linkedin:    "bg-blue-500/15 text-blue-300 border-blue-500/25",
  instagram:   "bg-pink-500/15 text-pink-300 border-pink-500/25",
  jobspy:      "bg-purple-500/15 text-purple-300 border-purple-500/25",
  greenhouse:  "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  lever:       "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  handshake:   "bg-orange-500/15 text-orange-300 border-orange-500/25",
}

function sourceStyle(source: string) {
  return SOURCE_STYLE[source.toLowerCase()] ?? "bg-white/8 text-white/50 border-white/12"
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all",      label: "All" },
  { id: "priority", label: "⭐ Priority" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "jobspy",   label: "JobSpy" },
  { id: "applied",  label: "Applied" },
  { id: "skipped",  label: "Skipped" },
]

export default function JobsPage() {
  const [jobs, setJobs]       = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [filter, setFilter]   = useState<Filter>("all")

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/queue?limit=20")
      if (res.ok) {
        const data = await res.json() as JobsResponse
        setJobs(data.jobs)
        setNextCursor(data.nextCursor)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
    const t = setInterval(fetchJobs, 60_000)
    return () => clearInterval(t)
  }, [fetchJobs])

  const filteredJobs = jobs.filter(j => {
    switch (filter) {
      case "priority": return j.isTopPriority
      case "linkedin": return j.source.toLowerCase().includes("linkedin")
      case "jobspy":   return ["jobspy","handshake","greenhouse","lever"].includes(j.source.toLowerCase())
      case "applied":  return j.status === "applied"
      case "skipped":  return j.status === "skipped"
      default:         return true
    }
  })

  const handleApprove = async (job: Job) => {
    setRemoving(prev => new Set([...prev, job.id]))
    try {
      const res = await fetch(`/api/jobs/${job.id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error("approve failed")
      toast.success("Approved — running recruiter search", {
        description: `${job.title} at ${job.company}`,
      })
      setTimeout(() => {
        setJobs(prev => prev.filter(j => j.id !== job.id))
        setRemoving(prev => { const n = new Set(prev); n.delete(job.id); return n })
      }, 280)
    } catch {
      setRemoving(prev => { const n = new Set(prev); n.delete(job.id); return n })
      toast.error("Failed to approve job")
    }
  }

  const handleSkip = async (job: Job) => {
    setRemoving(prev => new Set([...prev, job.id]))
    try {
      const res = await fetch(`/api/jobs/${job.id}/skip`, { method: "POST" })
      if (!res.ok) throw new Error("skip failed")
      toast("Skipped", { description: job.title })
      setTimeout(() => {
        setJobs(prev => prev.filter(j => j.id !== job.id))
        setRemoving(prev => { const n = new Set(prev); n.delete(job.id); return n })
      }, 280)
    } catch {
      setRemoving(prev => { const n = new Set(prev); n.delete(job.id); return n })
      toast.error("Failed to skip job")
    }
  }

  const handleApproveAll = async () => {
    if (filteredJobs.length === 0) return
    if (!confirm(`Approve all ${filteredJobs.length} visible jobs and trigger recruiter search for each?`)) return

    const batch = filteredJobs.slice()
    const ids = new Set(batch.map(j => j.id))
    setRemoving(ids)

    const results = await Promise.allSettled(
      batch.map(j => fetch(`/api/jobs/${j.id}/approve`, { method: "POST" }))
    )
    const failed = results.filter(r => r.status === "rejected").length

    setTimeout(() => {
      setJobs(prev => prev.filter(j => !ids.has(j.id)))
      setRemoving(new Set())
    }, 280)

    if (failed === 0) {
      toast.success(`Approved ${batch.length} jobs — running recruiter searches`)
    } else {
      toast.warning(`${batch.length - failed} approved, ${failed} failed`)
      fetchJobs()
    }
  }

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({
        limit: "20",
        cursor: nextCursor,
      })
      const res = await fetch(`/api/jobs/queue?${params.toString()}`)
      if (!res.ok) throw new Error("load more failed")
      const data = await res.json() as JobsResponse
      setJobs(prev => [...prev, ...data.jobs])
      setNextCursor(data.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Jobs Queue</h1>
            {!loading && (
              <span className="stat-badge">{jobs.length}</span>
            )}
          </div>
          <p className="text-white/40 text-sm mt-1">
            Review and approve jobs for automated application.
          </p>
        </div>
        {filteredJobs.length > 1 && (
          <button
            onClick={handleApproveAll}
            className="btn-primary px-4 py-2 text-sm shrink-0"
          >
            Approve All ({filteredJobs.length})
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex gap-0.5 mb-6 p-1 rounded-xl glass w-fit flex-wrap">
        {FILTERS.map(({ id, label }) => (
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
                <div className="flex gap-2">
                  <div className="h-8 w-14 bg-white/5 rounded-xl" />
                  <div className="h-8 w-20 bg-white/5 rounded-xl" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-5xl mb-4 opacity-20 select-none">◎</div>
          <div className="text-white/40 text-sm">
            {filter === "all"
              ? "No pending jobs. The scrapers run every 4 hours."
              : `No ${filter} jobs in the queue.`}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredJobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              removing={removing.has(job.id)}
              onApprove={handleApprove}
              onSkip={handleSkip}
            />
          ))}
        </div>
      )}

      {!loading && jobs.length > 0 && nextCursor !== null && (
        <div className="flex justify-center pt-5">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/75 backdrop-blur-xl transition-all hover:border-white/24 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore && (
              <span className="h-4 w-4 rounded-full border-2 border-white/25 border-t-white/80 animate-spin" />
            )}
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}

function JobCard({
  job,
  removing,
  onApprove,
  onSkip,
}: {
  job: Job
  removing: boolean
  onApprove: (j: Job) => void
  onSkip: (j: Job) => void
}) {
  return (
    <div
      className="glass-card p-4 transition-all duration-300"
      style={
        job.isTopPriority
          ? {
              borderColor: "rgba(251,191,36,0.28)",
              backgroundColor: "rgba(251,191,36,0.04)",
              opacity: removing ? 0 : 1,
              transform: removing ? "scale(0.96)" : "scale(1)",
            }
          : {
              opacity: removing ? 0 : 1,
              transform: removing ? "scale(0.96)" : "scale(1)",
            }
      }
    >
      <div className="flex gap-3 items-start">
        {/* Company initial */}
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 select-none ${
            job.isTopPriority
              ? "bg-amber-400/15 text-amber-300"
              : "bg-white/8 text-white/45"
          }`}
        >
          {job.company[0]?.toUpperCase() ?? "?"}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {job.isTopPriority && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md border bg-amber-400/12 text-amber-300 border-amber-400/28 whitespace-nowrap">
                ⭐ Priority
              </span>
            )}
            <span className="text-white font-semibold text-sm leading-snug">
              {job.title}
            </span>
            {job.matchScore != null && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${
                  job.matchScore >= 70
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : job.matchScore >= 40
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                    : "bg-red-500/15 text-red-300 border-red-500/30"
                }`}
              >
                {job.matchScore}% match
              </span>
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2.5 flex-wrap text-xs text-white/50">
            <span className="font-medium text-white/65">{job.company}</span>
            {job.location && (
              <span className="flex items-center gap-1">
                <span className="opacity-60">⚲</span>
                {job.location}
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded-md border font-medium ${sourceStyle(job.source)}`}
            >
              {job.source}
            </span>
            <span className="text-white/28">{timeAgo(job.createdAt)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={job.jobBoardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/5"
          >
            View ↗
          </a>
          <button
            onClick={() => onSkip(job)}
            disabled={removing}
            className="btn-ghost text-xs px-3 py-1.5 font-medium disabled:opacity-40"
          >
            Skip →
          </button>
          <button
            onClick={() => onApprove(job)}
            disabled={removing}
            className="text-xs px-3 py-1.5 font-semibold rounded-xl transition-all duration-150 disabled:opacity-40
              bg-emerald-500/18 text-emerald-300 border border-emerald-500/28
              hover:bg-emerald-500/28 hover:text-emerald-200 hover:-translate-y-px"
          >
            Approve ✓
          </button>
        </div>
      </div>
    </div>
  )
}
