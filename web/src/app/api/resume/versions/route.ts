import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const applications = await prisma.application.findMany({
      where: {
        resumeVersion: { not: null },
      },
      include: {
        job: {
          select: {
            title: true,
            company: true,
            source: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return NextResponse.json({ applications })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch resume versions" },
      { status: 500 }
    )
  }
}
