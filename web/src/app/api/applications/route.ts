import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const applications = await prisma.application.findMany({
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
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    return NextResponse.json({ applications })
  } catch (error) {
    console.error("Failed to fetch applications:", error)
    return NextResponse.json(
      { error: "Failed to fetch applications" },
      { status: 500 }
    )
  }
}
