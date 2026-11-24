-- Additive, nullable per-tenant GSP configuration.
-- No existing tenant or GST data is modified by this migration.
ALTER TABLE "Tenant"
  ADD COLUMN "gspCode" TEXT,
  ADD COLUMN "gspClientIdEnc" TEXT,
  ADD COLUMN "gspClientSecretEnc" TEXT,
  ADD COLUMN "gspUsernameEnc" TEXT,
  ADD COLUMN "gspPasswordEnc" TEXT,
  ADD COLUMN "irpEnv" TEXT NOT NULL DEFAULT 'sandbox',
  ADD COLUMN "gspConfigUpdatedAt" TIMESTAMP(3);
