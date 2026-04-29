-- Migration: make lead status and temperature dynamic (String instead of enum)
-- Preserves all existing data by casting enum values to their text representation.

-- Change "status" column from LeadStatus enum → TEXT
ALTER TABLE "Lead" ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'new';

-- Change "temperature" column from LeadTemperature enum → TEXT
ALTER TABLE "Lead" ALTER COLUMN "temperature" SET DATA TYPE TEXT USING "temperature"::TEXT;
ALTER TABLE "Lead" ALTER COLUMN "temperature" SET DEFAULT 'cold';

-- Drop the now-unused enum types (safe because no column references them anymore)
DROP TYPE IF EXISTS "LeadStatus";
DROP TYPE IF EXISTS "LeadTemperature";
