-- Apply after the Prisma schema migration.
-- The API must set app.current_owner_id on each database transaction before business queries.

-- This script is rerunnable. Apply only after all application paths use the transaction helpers.
DROP POLICY IF EXISTS property_owner_isolation ON "Property";
DROP POLICY IF EXISTS unit_owner_isolation ON "Unit";
DROP POLICY IF EXISTS tenant_owner_isolation ON "Tenant";
DROP POLICY IF EXISTS lease_owner_isolation ON "LeaseAgreement";
DROP POLICY IF EXISTS default_owner_isolation ON "BillDefault";
DROP POLICY IF EXISTS bill_owner_isolation ON "RentBill";
DROP POLICY IF EXISTS payment_owner_isolation ON "Payment";
DROP POLICY IF EXISTS repair_owner_isolation ON "Repair";
DROP POLICY IF EXISTS settlement_owner_isolation ON "MoveOutSettlement";
DROP POLICY IF EXISTS audit_owner_isolation ON "AuditLog";
DROP POLICY IF EXISTS refresh_session_owner_isolation ON "RefreshSession";
DROP POLICY IF EXISTS receipt_sequence_owner_isolation ON "ReceiptSequence";

ALTER TABLE "Property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Property" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Unit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Unit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseAgreement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseAgreement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BillDefault" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillDefault" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RentBill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RentBill" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Repair" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Repair" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MoveOutSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MoveOutSettlement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY property_owner_isolation ON "Property" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY unit_owner_isolation ON "Unit" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY tenant_owner_isolation ON "Tenant" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY lease_owner_isolation ON "LeaseAgreement" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY default_owner_isolation ON "BillDefault" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY bill_owner_isolation ON "RentBill" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY payment_owner_isolation ON "Payment" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY repair_owner_isolation ON "Repair" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY settlement_owner_isolation ON "MoveOutSettlement" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY audit_owner_isolation ON "AuditLog" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" IS NULL OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" IS NULL OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);

-- Receipt sequences are owner-scoped business records. Refresh sessions remain outside RLS because
-- refresh/logout discover the user only after verifying the signed token.
ALTER TABLE "ReceiptSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptSequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_sequence_owner_isolation ON "ReceiptSequence" USING ("ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK ("ownerId" = current_setting('app.current_owner_id', true)::uuid);
