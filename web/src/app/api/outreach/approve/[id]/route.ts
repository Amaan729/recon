import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await prisma.recruiterOutreach.update({
      where: { id },
      data: { status: "approved" },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to approve outreach" },
      { status: 500 }
    )
  }
}
