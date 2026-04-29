import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const agentUrl = (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "")

    const res = await fetch(
      `${agentUrl}/jobs/skip/${encodeURIComponent(id)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
      }
    )

    if (!res.ok) {
      throw new Error(`Agent skip returned ${res.status}`)
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Failed to skip job via agent, falling back to DB:", error)

    try {
      await prisma.job.update({
        where: { id },
        data: { status: "skipped" },
      })

      return NextResponse.json({
        status: "ok",
        job_id: id,
        fallback: "db",
      })
    } catch (dbError) {
      console.error("Failed to skip job via DB fallback:", dbError)
      return NextResponse.json(
        { error: "Failed to skip job" },
        { status: 500 }
      )
    }
  }
}
