-- Migration: Add Opportunity and ImportLog tables
-- Date: 2026-04-01

-- OpportunityStage enum
DO $$ BEGIN
  CREATE TYPE "OpportunityStage" AS ENUM (
    'prospecting',
    'qualification',
    'proposal',
    'negotiation',
    'closed_won',
    'closed_lost'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Opportunity table
CREATE TABLE IF NOT EXISTS "Opportunity" (
    "id"                TEXT NOT NULL,
    "organizationId"    TEXT NOT NULL,
    "leadId"            TEXT NOT NULL,
    "assignedToId"      TEXT,
    "createdById"       TEXT NOT NULL,
    "title"             TEXT NOT NULL,
    "stage"             "OpportunityStage" NOT NULL DEFAULT 'prospecting',
    "value"             DOUBLE PRECISION,
    "closeProbability"  INTEGER,
    "notes"             TEXT,
    "expectedCloseDate" TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- ImportLog table
CREATE TABLE IF NOT EXISTS "ImportLog" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "fileName"       TEXT NOT NULL,
    "totalRows"      INTEGER NOT NULL DEFAULT 0,
    "successRows"    INTEGER NOT NULL DEFAULT 0,
    "failedRows"     INTEGER NOT NULL DEFAULT 0,
    "errors"         JSONB NOT NULL DEFAULT '[]',
    "status"         TEXT NOT NULL DEFAULT 'completed',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- Foreign keys for Opportunity
ALTER TABLE "Opportunity"
    ADD CONSTRAINT "Opportunity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
    ADD CONSTRAINT "Opportunity_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
    ADD CONSTRAINT "Opportunity_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Opportunity"
    ADD CONSTRAINT "Opportunity_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign keys for ImportLog
ALTER TABLE "ImportLog"
    ADD CONSTRAINT "ImportLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImportLog"
    ADD CONSTRAINT "ImportLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS "Opportunity_organizationId_idx" ON "Opportunity"("organizationId");
CREATE INDEX IF NOT EXISTS "Opportunity_leadId_idx" ON "Opportunity"("leadId");
CREATE INDEX IF NOT EXISTS "Opportunity_assignedToId_idx" ON "Opportunity"("assignedToId");
CREATE INDEX IF NOT EXISTS "ImportLog_organizationId_idx" ON "ImportLog"("organizationId");
