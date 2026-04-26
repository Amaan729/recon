-- CreateTable
CREATE TABLE "AtsSlugs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "atsBoard" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "lastScrapedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AtsSlugs_slug_atsBoard_key" ON "AtsSlugs"("slug", "atsBoard");
