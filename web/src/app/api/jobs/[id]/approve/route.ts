import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await prisma.job.update({
      where: { id },
      data: { status: "approved", updatedAt: new Date() },
    })

    const job = await prisma.job.findUnique({ where: { id } })
    if (job?.company) {
      const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000"
      fetch(
        `${agentUrl}/recruiters/find/${encodeURIComponent(job.company)}`,
        { method: "POST" }
      ).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to approve job:", error)
    return NextResponse.json(
      { error: "Failed to approve job" },
      { status: 500 }
    )
  }
}
