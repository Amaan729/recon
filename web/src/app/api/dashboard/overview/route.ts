import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type AgentStatus = "idle" | "running" | "error"

async function getAgentStatus(): Promise<{ status: AgentStatus; lastRunAt: string | null }> {
  try {
    const agentUrl = (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "")
    const res = await fetch(`${agentUrl}/agent/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })

    if (!res.ok) {
      throw new Error(`Agent status returned ${res.status}`)
    }

    const data = await res.json() as { status?: AgentStatus; lastRunAt?: string | null }
    return {
      status: data.status ?? "idle",
      lastRunAt: data.lastRunAt ?? null,
    }
  } catch {
    return {
      status: "idle",
      lastRunAt: null,
    }
  }
}

export async function GET() {
  try {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const [pendingJobs, submitted, outreachToday, activePipeline, applications, agent] = await Promise.all([
      prisma.job.findMany({
        where: { status: "pending" },
        orderBy: [
          { isTopPriority: "desc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        take: 20,
      }),
      prisma.application.count({
        where: { status: "submitted" },
      }),
      prisma.recruiterOutreach.count({
        where: {
          sentAt: {
            gte: startOfToday,
          },
        },
      }),
      prisma.job.count({
        where: {
          status: {
            in: ["approved", "applied"],
          },
        },
      }),
      prisma.application.findMany({
        include: {
          job: {
            select: {
              title: true,
              company: true,
              location: true,
              source: true,
              jobBoardUrl: true,
              isTopPriority: true,
            },
          },
        },
        orderBy: [
          { submittedAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 10,
      }),
      getAgentStatus(),
    ])

    return NextResponse.json({
      stats: {
        pending: pendingJobs.length,
        submitted,
        outreachToday,
        activePipeline,
      },
      pendingJobs,
      applications,
      agent,
    })
  } catch (error) {
    console.error("Failed to build dashboard overview:", error)
    return NextResponse.json(
      { error: "Failed to load dashboard overview" },
      { status: 500 }
    )
  }
}
