import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const recruiters = await prisma.recruiter.findMany({
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
        { company: "asc" },
        { relevanceScore: "desc" },
      ],
      take: 500,
    })
    return NextResponse.json({ recruiters })
  } catch (error) {
    console.error("Failed to fetch recruiters:", error)
    return NextResponse.json(
      { error: "Failed to fetch recruiters" },
      { status: 500 }
    )
  }
}
