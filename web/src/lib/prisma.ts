import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

function createPrisma() {
  const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";

  let url: string;
  let authToken: string | undefined;

  if (dbUrl.startsWith("libsql://") || dbUrl.startsWith("https://")) {
    // Turso / remote libsql — use URL + auth token directly
    url = dbUrl;
    authToken = process.env.TURSO_AUTH_TOKEN;
  } else {
    // Local SQLite file — resolve absolute path relative to project root
    const filePath = dbUrl.replace(/^file:/, "");
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    url = `file:${absolutePath}`;
  }

  const adapter = new PrismaLibSql({ url, authToken });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
