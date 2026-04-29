import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const [pendingCount, queuedOutreachCount] = await Promise.all([
      prisma.job.count({
        where: { status: "pending" },
      }),
      prisma.recruiterOutreach.count({
        where: { status: "queued" },
      }),
    ])

    return NextResponse.json({
      pendingCount,
      queuedOutreachCount,
    })
  } catch (error) {
    console.error("Failed to fetch sidebar badge counts:", error)
    return NextResponse.json(
      {
        pendingCount: 0,
        queuedOutreachCount: 0,
      },
      { status: 200 }
    )
  }
}
