-- AlterTable: Add auto-generated formatted Opportunity ID (e.g. OPP-00125)
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Opportunity_opportunityId_key" ON "Opportunity"("opportunityId");
