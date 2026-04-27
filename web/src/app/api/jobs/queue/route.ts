import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (Number.isNaN(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 100)
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const limit = parseLimit(searchParams.get("limit"), 20)
    const cursor = searchParams.get("cursor")

    const cursorJob = cursor
      ? await prisma.job.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        })
      : null

    const jobs = await prisma.job.findMany({
      where: {
        status: "pending",
        ...(cursorJob ? { createdAt: { lt: cursorJob.createdAt } } : {}),
      },
      orderBy: [
        { isTopPriority: "desc" },
        { createdAt: "asc" },
      ],
      take: limit + 1,
    })

    let nextCursor: string | null = null
    if (jobs.length > limit) {
      const lastRow = jobs.pop()
      nextCursor = lastRow?.id ?? null
    }

    return NextResponse.json({ jobs, nextCursor })
  } catch (error) {
    console.error("Failed to fetch job queue:", error)
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    )
  }
}
