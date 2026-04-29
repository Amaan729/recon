import { NextResponse } from "next/server"

const SCRAPER_JOB_IDS = [
  "linkedin",
  "ats_api",
  "workday",
] as const

export async function POST() {
  try {
    const agentUrl = (process.env.AGENT_URL ?? "http://localhost:8000").replace(/\/$/, "")

    const results = await Promise.all(
      SCRAPER_JOB_IDS.map(async (jobId) => {
        try {
          const res = await fetch(`${agentUrl}/scheduler/trigger/${jobId}`, {
            method: "POST",
            signal: AbortSignal.timeout(8_000),
            headers: {
              "Content-Type": "application/json",
            },
          })

          if (!res.ok) {
            return {
              jobId,
              triggered: false,
              status: "error",
              statusCode: res.status,
              error: `Failed to trigger ${jobId} (${res.status})`,
            }
          }

          const data = await res.json() as { triggered?: boolean }
          return {
            jobId,
            triggered: Boolean(data.triggered),
            status: Boolean(data.triggered) ? "triggered" : "not_triggered",
          }
        } catch (error) {
          return {
            jobId,
            triggered: false,
            status: "error",
            error: error instanceof Error ? error.message : "Unknown trigger error",
          }
        }
      })
    )

    const failed = results.filter(result => !result.triggered)

    return NextResponse.json({
      status: failed.length > 0 ? "partial" : "ok",
      results,
    })
  } catch (error) {
    console.error("Failed to trigger scrapers:", error)
    return NextResponse.json(
      { error: "Failed to trigger scrapers" },
      { status: 500 }
    )
  }
}
