-- AlterTable: add lead-contact link fields and make email optional
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "leadId" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "linkedin" TEXT;
ALTER TABLE "Contact" ALTER COLUMN "email" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
