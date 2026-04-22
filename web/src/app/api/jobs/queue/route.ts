import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const jobs = await prisma.job.findMany({
      where: { status: "pending" },
      orderBy: [
        { isTopPriority: "desc" },
        { createdAt: "asc" },
      ],
      take: 100,
    })
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error("Failed to fetch job queue:", error)
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    )
  }
}
