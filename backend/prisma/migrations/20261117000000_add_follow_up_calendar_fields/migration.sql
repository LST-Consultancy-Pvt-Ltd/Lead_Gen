-- Follow-up Calendar: opportunities get their own follow-up date, separate from
-- expectedCloseDate (a deal's close date is not a follow-up).
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "followUpDate" TIMESTAMP(3);

-- Back-fill: seed each open opportunity's follow-up date from the latest
-- activity logged against it, falling back to its expected close date.
UPDATE "Opportunity" o
SET "followUpDate" = COALESCE(
  (SELECT MAX(a."nextActionDate") FROM "ActivityLog" a WHERE a."opportunityId" = o."id"),
  o."expectedCloseDate"
)
WHERE o."followUpDate" IS NULL
  AND o."stage" NOT IN ('closed_won', 'closed_lost');

-- Calendar reads a month at a time, scoped by org and by assignee.
CREATE INDEX IF NOT EXISTS "Lead_organizationId_followUpDate_idx" ON "Lead"("organizationId", "followUpDate");
CREATE INDEX IF NOT EXISTS "Lead_assignedToId_followUpDate_idx" ON "Lead"("assignedToId", "followUpDate");
CREATE INDEX IF NOT EXISTS "Opportunity_organizationId_followUpDate_idx" ON "Opportunity"("organizationId", "followUpDate");
CREATE INDEX IF NOT EXISTS "Opportunity_assignedToId_followUpDate_idx" ON "Opportunity"("assignedToId", "followUpDate");
