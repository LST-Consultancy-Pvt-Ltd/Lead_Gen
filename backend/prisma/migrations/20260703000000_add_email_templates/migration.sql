-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'EmailTemplate_organizationId_fkey'
    ) THEN
        ALTER TABLE "EmailTemplate"
            ADD CONSTRAINT "EmailTemplate_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
