-- Recreate LeadStatus enum if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadStatus') THEN
    CREATE TYPE "LeadStatus" AS ENUM (
      'new', 'contacted', 'replied', 'meeting_booked', 'qualified',
      'disqualified', 'closed_won', 'closed_lost',
      'warm', 'hot', 'proposal_sent', 'negotiation',
      'won', 'lost', 'on_hold', 'unqualified'
    );
  END IF;
END $$;

ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'warm';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'hot';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'proposal_sent';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'negotiation';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'won';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'lost';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'unqualified';