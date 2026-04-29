"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
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
  useResumeTailor: boolean
  runRecruiterSearch: boolean
  matchScore: number | null
  createdAt: string
}

type JobsResponse = {
  jobs: Job[]
  nextCursor: string | null
}

type ScraperJobId = "linkedin" | "ats_api" | "workday"

type ScraperJobStatus = {
  job_id: string
  name?: string
  status?: string
  last_run_status?: string
  last_run_at: string | null
  next_run_time: string | null
  current_message?: string | null
  last_summary?: {
    message?: string
    boards?: Record<string, { attempted?: number; inserted?: number }>
  } | null
}

type ScrapersRunResponse = {
  status: "ok" | "partial"
  results: Array<{
    jobId: ScraperJobId
    triggered: boolean
    status: string
    error?: string
  }>
}

type ScrapersStatusResponse = {
  jobs: ScraperJobStatus[]
}

type JobOptions = {
  useResumeTailor: boolean
  runRecruiterSearch: boolean
}

type JobOptionKey = keyof JobOptions
type Filter = "all" | "priority" | "linkedin" | "jobspy"

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "priority", label: "⭐ Priority" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "jobspy", label: "Job Boards" },
]

const SCRAPER_JOB_IDS: ScraperJobId[] = ["linkedin", "ats_api", "workday"]

const SCRAPER_LABELS: Record<ScraperJobId, string> = {
  linkedin: "LinkedIn",
  ats_api: "ATS API",
  workday: "Workday",
}

const SOURCE_STYLE: Record<string, string> = {
  linkedin: "bg-blue-500/15 text-blue-300 border-blue-500/25",
  instagram: "bg-pink-500/15 text-pink-300 border-pink-500/25",
  jobspy: "bg-purple-500/15 text-purple-300 border-purple-500/25",
  greenhouse: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  lever: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  handshake: "bg-orange-500/15 text-orange-300 border-orange-500/25",
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

function defaultOptions(job: Job): JobOptions {
  return {
    useResumeTailor: Boolean(job.useResumeTailor),
    runRecruiterSearch: Boolean(job.runRecruiterSearch),
  }
}

function mergeJobOptions(
  previous: Record<string, JobOptions>,
  incomingJobs: Job[]
): Record<string, JobOptions> {
  const next = { ...previous }
  for (const job of incomingJobs) {
    if (!next[job.id]) {
      next[job.id] = defaultOptions(job)
    }
  }
  return next
}

function buildOptionSummary(options: JobOptions): string {
  const enabled: string[] = []
  if (options.useResumeTailor) {
    enabled.push("resume tailoring")
  }
  if (options.runRecruiterSearch) {
    enabled.push("recruiter search after apply")
  }
  return enabled.length > 0 ? enabled.join(" + ") : "base resume, no recruiter search"
}

function scraperState(status: ScraperJobStatus | undefined) {
  return status?.status ?? status?.last_run_status ?? "never"
}

function scraperSettledAfter(status: ScraperJobStatus | undefined, startedAt: number) {
  if (!status) return false
  const state = scraperState(status)
  if (state === "running") return false
  if (!status.last_run_at) return false
  return new Date(status.last_run_at).getTime() >= startedAt - 1_000
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function formatRunTime(value: string | null) {
  if (!value) return "Not run yet"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown time"
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobOptions, setJobOptions] = useState<Record<string, JobOptions>>({})
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [runningScrapers, setRunningScrapers] = useState(false)
  const [scraperStatuses, setScraperStatuses] = useState<ScraperJobStatus[]>([])
  const [activeScraperIds, setActiveScraperIds] = useState<ScraperJobId[]>([])
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>("all")

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/queue?limit=20")
      if (!res.ok) {
        throw new Error("queue fetch failed")
      }

      const data = await res.json() as JobsResponse
      setJobs(data.jobs)
      setNextCursor(data.nextCursor)
      setJobOptions(prev => mergeJobOptions(prev, data.jobs))
    } catch {
      toast.error("Failed to load jobs queue")
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchScraperStatuses = useCallback(async () => {
    const res = await fetch("/api/scrapers/status", { cache: "no-store" })
    if (!res.ok) {
      throw new Error("scraper status fetch failed")
    }

    const data = await res.json() as ScrapersStatusResponse
    setScraperStatuses(data.jobs)
    return data.jobs
  }, [])

  useEffect(() => {
    const initialFetch = window.setTimeout(() => {
      void fetchJobs()
      void fetchScraperStatuses().catch(() => undefined)
    }, 0)
    const t = setInterval(() => {
      void fetchJobs()
      void fetchScraperStatuses().catch(() => undefined)
    }, 60_000)
    return () => {
      window.clearTimeout(initialFetch)
      clearInterval(t)
    }
  }, [fetchJobs, fetchScraperStatuses])

  const filteredJobs = jobs.filter((job) => {
    switch (filter) {
      case "priority":
        return job.isTopPriority
      case "linkedin":
        return job.source.toLowerCase().includes("linkedin")
      case "jobspy":
        return ["jobspy", "handshake", "greenhouse", "lever"].includes(job.source.toLowerCase())
      default:
        return true
    }
  })

  const toggleOption = (jobId: string, key: JobOptionKey) => {
    setJobOptions(prev => {
      const current = prev[jobId] ?? { useResumeTailor: false, runRecruiterSearch: false }
      return {
        ...prev,
        [jobId]: {
          ...current,
          [key]: !current[key],
        },
      }
    })
  }

  const handleQueue = async (job: Job) => {
    const options = jobOptions[job.id] ?? defaultOptions(job)
    setRemoving(prev => new Set([...prev, job.id]))

    try {
      const res = await fetch(`/api/jobs/${job.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options),
      })
      const data = await res.json().catch(() => null) as { error?: string; message?: string } | null

      if (!res.ok && res.status !== 409) {
        throw new Error(data?.error ?? "queue failed")
      }

      if (res.status === 409) {
        toast.info("Queue already updated", {
          description: data?.message ?? `${job.title} is no longer pending.`,
        })
      } else {
        toast.success("Queued for apply", {
          description: `${job.title} at ${job.company} · ${buildOptionSummary(options)}`,
        })
      }

      await fetchJobs()
    } catch (error) {
      toast.error("Failed to queue job for apply", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(job.id)
        return next
      })
    }
  }

  const handleSkip = async (job: Job) => {
    setRemoving(prev => new Set([...prev, job.id]))
    try {
      const res = await fetch(`/api/jobs/${job.id}/skip`, { method: "POST" })
      if (!res.ok) {
        throw new Error("skip failed")
      }
      toast("Skipped", { description: job.title })
      setTimeout(() => {
        setJobs(prev => prev.filter((candidate) => candidate.id !== job.id))
        setJobOptions(prev => {
          const next = { ...prev }
          delete next[job.id]
          return next
        })
        setRemoving(prev => {
          const next = new Set(prev)
          next.delete(job.id)
          return next
        })
      }, 280)
    } catch {
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(job.id)
        return next
      })
      toast.error("Failed to skip job")
    }
  }

  const handleRunScrapers = async () => {
    if (runningScrapers) {
      return
    }
    setRunningScrapers(true)
    setActiveScraperIds(SCRAPER_JOB_IDS)
    const startedAt = Date.now()

    try {
      const res = await fetch("/api/scrapers/run", { method: "POST" })
      const data = await res.json().catch(() => null) as ScrapersRunResponse | null
      if (!res.ok) {
        throw new Error("scraper trigger failed")
      }
      const triggeredIds = data?.results
        .filter(result => result.triggered)
        .map(result => result.jobId) ?? []
      const failed = data?.results.filter(result => !result.triggered) ?? []

      if (failed.length > 0) {
        toast.error("Some scrapers did not start", {
          description: failed.map(result => result.jobId).join(", "),
        })
      }

      if (triggeredIds.length === 0) {
        throw new Error("No scrapers were triggered")
      }

      toast.success("Scrapers started", {
        description: "Polling live progress until LinkedIn, ATS API, and Workday settle.",
      })

      await fetchScraperStatuses()

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const statuses = await fetchScraperStatuses()
        const byId = new Map(statuses.map(status => [status.job_id, status]))
        const settled = triggeredIds.every(jobId => scraperSettledAfter(byId.get(jobId), startedAt))
        if (settled) {
          break
        }
        await sleep(2_500)
      }

      await fetchJobs()
    } catch (error) {
      toast.error("Failed to start scrapers", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setRunningScrapers(false)
    }
  }

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) {
      return
    }

    setLoadingMore(true)
    try {
      const params = new URLSearchParams({
        limit: "20",
        cursor: nextCursor,
      })
      const res = await fetch(`/api/jobs/queue?${params.toString()}`)
      if (!res.ok) {
        throw new Error("load more failed")
      }

      const data = await res.json() as JobsResponse
      setJobs(prev => [...prev, ...data.jobs])
      setNextCursor(data.nextCursor)
      setJobOptions(prev => mergeJobOptions(prev, data.jobs))
    } finally {
      setLoadingMore(false)
    }
  }

  const scraperStatusById = new Map(scraperStatuses.map(status => [status.job_id, status]))

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Jobs Queue</h1>
            {!loading && <span className="stat-badge">{jobs.length}</span>}
          </div>
          <p className="text-white/40 text-sm mt-1">
            Review jobs, set optional recruiter search or resume tailoring, and queue them for the apply agent.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/dashboard"
            className="px-4 py-2 text-sm rounded-xl border border-white/12 text-white/65 hover:text-white hover:border-white/20 hover:bg-white/6 transition-all"
          >
            ← Dashboard
          </Link>
          <button
            onClick={handleRunScrapers}
            disabled={runningScrapers}
            className="btn-primary px-4 py-2 text-sm shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {runningScrapers ? "Starting Scrapers…" : "Run Scrapers Now"}
          </button>
        </div>
      </div>

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

      {(runningScrapers || scraperStatuses.length > 0) && (
        <ScraperProgress
          activeIds={activeScraperIds}
          running={runningScrapers}
          statusById={scraperStatusById}
        />
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
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
              ? "No pending jobs. Run scrapers now or wait for the next scheduled pass."
              : `No ${filter} jobs in the queue.`}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              options={jobOptions[job.id] ?? defaultOptions(job)}
              removing={removing.has(job.id)}
              onToggleOption={toggleOption}
              onQueue={handleQueue}
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

function ScraperProgress({
  activeIds,
  running,
  statusById,
}: {
  activeIds: ScraperJobId[]
  running: boolean
  statusById: Map<string, ScraperJobStatus>
}) {
  return (
    <div className="glass-card mb-6 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Scraper Progress</div>
          <div className="text-xs text-white/35">
            {running ? "Live run in progress" : "Last known scheduler status"}
          </div>
        </div>
        {running && (
          <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-200">
            Polling
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {SCRAPER_JOB_IDS.map(jobId => {
          const status = statusById.get(jobId)
          const state = scraperState(status)
          const isActive = activeIds.includes(jobId)
          const tone =
            state === "running"
              ? "border-blue-400/25 bg-blue-400/10 text-blue-200"
              : state === "success"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : state === "failed"
              ? "border-red-400/25 bg-red-400/10 text-red-200"
              : "border-white/10 bg-white/5 text-white/55"
          const summary = status?.current_message ?? status?.last_summary?.message
          const boardSummary = status?.last_summary?.boards
            ? Object.entries(status.last_summary.boards)
                .map(([board, counts]) => {
                  const label = board[0]?.toUpperCase() + board.slice(1)
                  return `${label}: ${counts.inserted ?? 0}/${counts.attempted ?? 0}`
                })
                .join(" · ")
            : null

          return (
            <div key={jobId} className={`rounded-2xl border p-3 ${tone}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{SCRAPER_LABELS[jobId]}</span>
                <span className="text-[11px] uppercase tracking-wider opacity-70">
                  {isActive && running && state !== "success" && state !== "failed"
                    ? "triggered"
                    : state}
                </span>
              </div>
              <div className="text-xs opacity-75">
                {summary ?? "Waiting for scheduler update"}
              </div>
              {boardSummary && (
                <div className="mt-2 text-[11px] opacity-70">{boardSummary}</div>
              )}
              <div className="mt-2 text-[11px] opacity-55">
                Last run: {formatRunTime(status?.last_run_at ?? null)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function JobCard({
  job,
  options,
  removing,
  onToggleOption,
  onQueue,
  onSkip,
}: {
  job: Job
  options: JobOptions
  removing: boolean
  onToggleOption: (jobId: string, key: JobOptionKey) => void
  onQueue: (job: Job) => void
  onSkip: (job: Job) => void
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
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 select-none ${
            job.isTopPriority
              ? "bg-amber-400/15 text-amber-300"
              : "bg-white/8 text-white/45"
          }`}
        >
          {job.company[0]?.toUpperCase() ?? "?"}
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div>
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

          <div className="flex flex-wrap items-center gap-2">
            <OptionToggle
              label="Resume Tailor"
              enabled={options.useResumeTailor}
              disabled={removing}
              onClick={() => onToggleOption(job.id, "useResumeTailor")}
            />
            <OptionToggle
              label="Recruiter Search"
              enabled={options.runRecruiterSearch}
              disabled={removing}
              onClick={() => onToggleOption(job.id, "runRecruiterSearch")}
            />
          </div>
        </div>

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
            onClick={() => onQueue(job)}
            disabled={removing}
            className="text-xs px-3 py-1.5 font-semibold rounded-xl transition-all duration-150 disabled:opacity-40
              bg-emerald-500/18 text-emerald-300 border border-emerald-500/28
              hover:bg-emerald-500/28 hover:text-emerald-200 hover:-translate-y-px"
          >
            Queue for Apply
          </button>
        </div>
      </div>
    </div>
  )
}

function OptionToggle({
  label,
  enabled,
  disabled,
  onClick,
}: {
  label: string
  enabled: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-40 ${
        enabled
          ? "border-blue-500/35 bg-blue-500/15 text-blue-200"
          : "border-white/12 bg-white/5 text-white/55 hover:border-white/20 hover:text-white/75"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${enabled ? "bg-blue-300" : "bg-white/25"}`}
      />
      {label}
    </button>
  )
}
