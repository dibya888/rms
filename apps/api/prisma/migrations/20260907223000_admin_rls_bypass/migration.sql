-- The AuditLog policy already lets a system-admin session (app.is_system_admin
-- = 'true') see/modify rows regardless of app.current_owner_id. Every other
-- owner-scoped table was missing that bypass, so any query run inside
-- withSystemAdmin() (which sets is_system_admin but not current_owner_id)
-- was silently restricted to zero rows on these tables by Postgres RLS —
-- independent of, and invisible to, whatever `where` clause Prisma sent.
-- This left the admin "clean database" and "delete user" actions unable to
-- actually remove business data. Add the same bypass used for AuditLog.

DROP POLICY IF EXISTS property_owner_isolation ON "Property";
DROP POLICY IF EXISTS unit_owner_isolation ON "Unit";
DROP POLICY IF EXISTS tenant_owner_isolation ON "Tenant";
DROP POLICY IF EXISTS lease_owner_isolation ON "LeaseAgreement";
DROP POLICY IF EXISTS default_owner_isolation ON "BillDefault";
DROP POLICY IF EXISTS bill_owner_isolation ON "RentBill";
DROP POLICY IF EXISTS payment_owner_isolation ON "Payment";
DROP POLICY IF EXISTS repair_owner_isolation ON "Repair";
DROP POLICY IF EXISTS settlement_owner_isolation ON "MoveOutSettlement";
DROP POLICY IF EXISTS receipt_sequence_owner_isolation ON "ReceiptSequence";

CREATE POLICY property_owner_isolation ON "Property" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY unit_owner_isolation ON "Unit" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY tenant_owner_isolation ON "Tenant" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY lease_owner_isolation ON "LeaseAgreement" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY default_owner_isolation ON "BillDefault" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY bill_owner_isolation ON "RentBill" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY payment_owner_isolation ON "Payment" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY repair_owner_isolation ON "Repair" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY settlement_owner_isolation ON "MoveOutSettlement" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
CREATE POLICY receipt_sequence_owner_isolation ON "ReceiptSequence" USING (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid) WITH CHECK (current_setting('app.is_system_admin', true) = 'true' OR "ownerId" = current_setting('app.current_owner_id', true)::uuid);
