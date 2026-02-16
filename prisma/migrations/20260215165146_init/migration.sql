-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startTime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CanonicalMarket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalMarket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Market_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Market_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalMarketId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "method" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketMapping_canonicalMarketId_fkey" FOREIGN KEY ("canonicalMarketId") REFERENCES "CanonicalMarket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketMapping_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CanonicalOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalMarketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalOutcome_canonicalMarketId_fkey" FOREIGN KEY ("canonicalMarketId") REFERENCES "CanonicalMarket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Outcome_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutcomeLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalOutcomeId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    CONSTRAINT "OutcomeLink_canonicalOutcomeId_fkey" FOREIGN KEY ("canonicalOutcomeId") REFERENCES "CanonicalOutcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OutcomeLink_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outcomeId" TEXT NOT NULL,
    "decimalOdds" REAL NOT NULL,
    "bid" REAL,
    "ask" REAL,
    "source" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quote_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketMapping_canonicalMarketId_marketId_key" ON "MarketMapping"("canonicalMarketId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeLink_canonicalOutcomeId_outcomeId_key" ON "OutcomeLink"("canonicalOutcomeId", "outcomeId");

-- CreateIndex
CREATE INDEX "Quote_timestamp_idx" ON "Quote"("timestamp");
