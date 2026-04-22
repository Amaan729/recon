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
      data: { status: "skipped", updatedAt: new Date() },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to skip job:", error)
    return NextResponse.json(
      { error: "Failed to skip job" },
      { status: 500 }
    )
  }
}
