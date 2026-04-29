import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type QueuePayload = {
  useResumeTailor: boolean
  runRecruiterSearch: boolean
}

type QueueResponse = {
  status: "ok" | "conflict"
  job_id: string
  queued_for_apply: boolean
  useResumeTailor: boolean
  runRecruiterSearch: boolean
  currentStatus?: string
  message?: string
}

function parseQueuePayload(value: unknown): QueuePayload | { error: string; details: Record<string, string> } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      error: "Invalid request body",
      details: { body: "Expected a JSON object" },
    }
  }

  const record = value as Record<string, unknown>
  const details: Record<string, string> = {}

  for (const key of ["useResumeTailor", "runRecruiterSearch"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") {
      details[key] = "Expected a boolean"
    }
  }

  if (Object.keys(details).length > 0) {
    return {
      error: "Invalid request body",
      details,
    }
  }

  return {
    useResumeTailor: record.useResumeTailor === true,
    runRecruiterSearch: record.runRecruiterSearch === true,
  }
}

function queueResponse(
  id: string,
  payload: QueuePayload,
  overrides: Partial<QueueResponse> = {}
): QueueResponse {
  return {
    status: "ok",
    job_id: id,
    queued_for_apply: true,
    useResumeTailor: payload.useResumeTailor,
    runRecruiterSearch: payload.runRecruiterSearch,
    ...overrides,
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  let parsedBody: unknown

  try {
    parsedBody = await req.json()
  } catch {
    parsedBody = {}
  }

  const payload = parseQueuePayload(parsedBody)
  if ("error" in payload) {
    return NextResponse.json(payload, { status: 400 })
  }

  try {
    const agentUrl = (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "")
    const res = await fetch(
      `${agentUrl}/jobs/approve/${encodeURIComponent(id)}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) {
      throw new Error(`Agent approve returned ${res.status}`)
    }
    const data = await res.json().catch(() => ({})) as Partial<QueueResponse>
    return NextResponse.json(queueResponse(id, payload, data))
  } catch (error) {
    console.error("Failed to approve job via agent, falling back to DB:", error)

    try {
      const existingJob = await prisma.job.findUnique({
        where: { id },
        select: { status: true },
      })

      if (!existingJob) {
        return NextResponse.json(
          {
            error: "Job not found",
            code: "JOB_NOT_FOUND",
            job_id: id,
          },
          { status: 404 }
        )
      }

      if (existingJob.status !== "pending") {
        return NextResponse.json(
          queueResponse(id, payload, {
            status: "conflict",
            queued_for_apply: existingJob.status === "approved",
            currentStatus: existingJob.status,
            message: "Job is no longer pending",
          }),
          { status: 409 }
        )
      }

      await prisma.job.update({
        where: { id },
        data: {
          status: "approved",
          useResumeTailor: payload.useResumeTailor,
          runRecruiterSearch: payload.runRecruiterSearch,
        },
      })

      return NextResponse.json(queueResponse(id, payload))
    } catch (dbError) {
      console.error("Failed to approve job via DB fallback:", dbError)
      return NextResponse.json(
        {
          error: "Failed to approve job",
          code: "QUEUE_APPROVE_FAILED",
          job_id: id,
        },
        { status: 500 }
      )
    }
  }
}
