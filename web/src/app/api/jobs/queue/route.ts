import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (Number.isNaN(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 100)
}

export async function GET(request: NextRequest) {
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 20)
  const cursor = request.nextUrl.searchParams.get("cursor")

  try {
    const agentUrl = (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "")
    const query = request.nextUrl.searchParams.toString()
    const targetUrl = query ? `${agentUrl}/jobs/queue?${query}` : `${agentUrl}/jobs/queue`

    const res = await fetch(targetUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!res.ok) {
      throw new Error(`Agent queue returned ${res.status}`)
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to fetch job queue from agent, falling back to DB:", error)

    try {
      const pendingJobs = await prisma.job.findMany({
        where: { status: "pending" },
        orderBy: [
          { isTopPriority: "desc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      })

      const startIndex = cursor
        ? Math.max(pendingJobs.findIndex((job) => job.id === cursor) + 1, 0)
        : 0

      const page = pendingJobs.slice(startIndex, startIndex + limit + 1)
      const hasMore = page.length > limit
      const jobs = hasMore ? page.slice(0, limit) : page
      const nextCursor = hasMore ? jobs[jobs.length - 1]?.id ?? null : null

      return NextResponse.json({ jobs, nextCursor })
    } catch (dbError) {
      console.error("Failed to fetch job queue from DB:", dbError)
      return NextResponse.json(
        { error: "Failed to fetch jobs" },
        { status: 500 }
      )
    }
  }
}
