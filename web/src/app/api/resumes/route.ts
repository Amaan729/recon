import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resumes = await prisma.resume.findMany({
    where: { userId: session.user.id },
    include: { opens: { where: { isSelf: false } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(
    resumes.map((r: typeof resumes[number]) => ({
      id: r.id,
      name: r.name,
      filename: r.filename,
      isDefault: r.isDefault,
      openCount: r.opens.length,
      createdAt: r.createdAt,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = formData.get("name") as string | null;
  const setDefault = formData.get("isDefault") === "true";

  if (!file || !name) return NextResponse.json({ error: "Missing file or name" }, { status: 400 });
  if (!file.name.endsWith(".pdf")) return NextResponse.json({ error: "Only PDF files" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Store in public/uploads/resumes/[userId]/
  const dir = path.join(process.cwd(), "public", "uploads", "resumes", userId);
  await mkdir(dir, { recursive: true });

  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  await writeFile(path.join(dir, filename), buffer);

  if (setDefault) {
    await prisma.resume.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
  }

  const resume = await prisma.resume.create({
    data: { userId, name, filename, isDefault: setDefault },
  });

  return NextResponse.json(resume);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, isDefault, name } = await req.json();
  const userId = session.user.id;

  if (isDefault) {
    await prisma.resume.updateMany({ where: { userId }, data: { isDefault: false } });
  }

  const resume = await prisma.resume.update({
    where: { id, userId },
    data: { ...(name && { name }), ...(isDefault !== undefined && { isDefault }) },
  });

  return NextResponse.json(resume);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await prisma.resume.delete({ where: { id, userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
