/*
  Warnings:

  - A unique constraint covering the columns `[bookId,externalId]` on the table `Market` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `canonicalKey` to the `CanonicalMarket` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CanonicalMarket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalMarket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CanonicalMarket" ("createdAt", "eventId", "id", "marketType", "name") SELECT "createdAt", "eventId", "id", "marketType", "name" FROM "CanonicalMarket";
DROP TABLE "CanonicalMarket";
ALTER TABLE "new_CanonicalMarket" RENAME TO "CanonicalMarket";
CREATE UNIQUE INDEX "CanonicalMarket_canonicalKey_key" ON "CanonicalMarket"("canonicalKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Market_bookId_externalId_key" ON "Market"("bookId", "externalId");
