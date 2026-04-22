import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const { company } = await req.json() as { company: string }
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 })
    const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000"
    const res = await fetch(`${agentUrl}/recruiters/find/${encodeURIComponent(company)}`, {
      method: "POST",
    })
    if (!res.ok) throw new Error(`Agent returned ${res.status}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to trigger recruiter search:", error)
    return NextResponse.json({ error: "Failed to trigger recruiter search" }, { status: 500 })
  }
}
