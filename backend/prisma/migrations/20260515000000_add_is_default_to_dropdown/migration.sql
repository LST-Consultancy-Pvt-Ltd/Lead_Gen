-- AlterTable
ALTER TABLE "DropdownConfig" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
