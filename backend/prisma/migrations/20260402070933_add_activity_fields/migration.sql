-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "activityDate" TIMESTAMP(3),
ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "linkedType" TEXT,
ADD COLUMN     "nextActionDate" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "outcome" TEXT;
