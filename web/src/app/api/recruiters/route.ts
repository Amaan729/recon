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
    const company = searchParams.get("company")?.trim() ?? ""

    const cursorRecruiter = cursor
      ? await prisma.recruiter.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        })
      : null

    const recruiters = await prisma.recruiter.findMany({
      where: {
        ...(company
          ? {
              company: {
                contains: company,
              },
            }
          : {}),
        ...(cursorRecruiter ? { createdAt: { lt: cursorRecruiter.createdAt } } : {}),
      },
      include: {
        outreach: {
          select: {
            id: true,
            channel: true,
            status: true,
            sentAt: true,
            messageText: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [
        { relevanceScore: "desc" },
        { createdAt: "desc" },
      ],
      take: limit + 1,
    })

    let nextCursor: string | null = null
    if (recruiters.length > limit) {
      const lastRow = recruiters.pop()
      nextCursor = lastRow?.id ?? null
    }

    return NextResponse.json({ recruiters, nextCursor })
  } catch (error) {
    console.error("Failed to fetch recruiters:", error)
    return NextResponse.json(
      { error: "Failed to fetch recruiters" },
      { status: 500 }
    )
  }
}
