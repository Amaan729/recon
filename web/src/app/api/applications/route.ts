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

    const cursorApplication = cursor
      ? await prisma.application.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        })
      : null

    const applications = await prisma.application.findMany({
      where: cursorApplication ? { createdAt: { lt: cursorApplication.createdAt } } : undefined,
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
        recruiterOutreach: {
          select: {
            id: true,
            channel: true,
            status: true,
            sentAt: true,
            messageText: true,
            recruiter: {
              select: {
                name: true,
                title: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [
        { submittedAt: "desc" },
        { createdAt: "desc" },
      ],
      take: limit + 1,
    })

    let nextCursor: string | null = null
    if (applications.length > limit) {
      const lastRow = applications.pop()
      nextCursor = lastRow?.id ?? null
    }

    return NextResponse.json({ applications, nextCursor })
  } catch (error) {
    console.error("Failed to fetch applications:", error)
    return NextResponse.json(
      { error: "Failed to fetch applications" },
      { status: 500 }
    )
  }
}
