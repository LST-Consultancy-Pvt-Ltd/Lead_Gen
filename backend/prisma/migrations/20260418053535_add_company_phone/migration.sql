-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadTemperature" ADD VALUE 'prospect';
ALTER TYPE "LeadTemperature" ADD VALUE 'lost';
ALTER TYPE "LeadTemperature" ADD VALUE 'won';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "companyPhone" TEXT;
