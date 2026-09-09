-- Investigating slow dashboard loads: DashboardService.summary() runs its
-- read queries inside a single withOwner() transaction, which sets the
-- Postgres session variable Row-Level Security relies on
-- (app.current_owner_id). That's a correctness requirement (RLS needs every
-- query in the same DB session as the SET), but it also means the ~11
-- queries run one-after-another against a single connection rather than
-- truly in parallel, so each query's cost adds directly to the page's total
-- load time instead of overlapping.
--
-- Two of those queries were filtering AND sorting on columns Postgres had no
-- combined index for, forcing a sort step after the index scan on every
-- dashboard load as data grows:
--   Payment.findMany({ where: { ownerId }, orderBy: { paidOn: 'desc' } })
--   Repair.findMany({ where: { ownerId }, orderBy: { repairDate: 'desc' } })
-- Both already had a plain ownerId index; this adds the composite index so
-- the same query is satisfied by a single index scan in the right order.
--
-- This does not touch the RLS transaction pattern itself — the sequential
-- nature of withOwner() is a separate, larger, higher-risk change that
-- wasn't made here. On top of this, dashboard latency on the free tier is
-- also very likely dominated by Render's own cold start and by Neon's
-- Postgres compute auto-suspending on inactivity (a separate cold start from
-- Render's) — both outside what an index can fix.

CREATE INDEX IF NOT EXISTS "Payment_ownerId_paidOn_idx" ON "Payment"("ownerId", "paidOn");
CREATE INDEX IF NOT EXISTS "Repair_ownerId_repairDate_idx" ON "Repair"("ownerId", "repairDate");
