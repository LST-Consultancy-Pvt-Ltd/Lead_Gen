-- AlterTable: link a Lead to the scan that created it + the platform keyword it was found for
ALTER TABLE "Lead" ADD COLUMN "scanJobId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "keyword" TEXT;

-- AlterTable: store the platform keyword(s) the scan searched for
ALTER TABLE "ScanJob" ADD COLUMN "keyword" TEXT;
