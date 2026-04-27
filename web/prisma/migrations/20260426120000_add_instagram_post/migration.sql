CREATE TABLE IF NOT EXISTS "InstagramPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postUrl" TEXT NOT NULL,
    "caption" TEXT,
    "companyMentioned" TEXT,
    "postedAt" DATETIME,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "InstagramPost_postUrl_key" ON "InstagramPost"("postUrl");
