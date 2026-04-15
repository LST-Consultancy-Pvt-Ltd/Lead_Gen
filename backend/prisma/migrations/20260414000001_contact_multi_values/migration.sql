-- Add multiple emails, phones, and LinkedIn URLs fields to Contact
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "additionalEmails" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "additionalPhones" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "additionalLinkedinUrls" TEXT[] NOT NULL DEFAULT '{}';
