-- Adds a username, alongside email, as a second way to sign in. Added
-- nullable first because existing accounts have no username yet; this
-- backfills every existing account with one derived from its email
-- address before the column is locked down to NOT NULL + UNIQUE, so the
-- constraint can never fail partway through on real data.

ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Backfill: the part of the email before '@', lowercased, with anything
-- that isn't a letter/digit/underscore stripped out. Duplicates (e.g.
-- alice@company-a.com and alice@company-b.com both reducing to "alice")
-- are disambiguated by appending their row's rank within that base name,
-- ordered by account age so the oldest account keeps the clean name.
WITH candidates AS (
  SELECT
    "id",
    NULLIF(regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]', '', 'g'), '') AS base,
    "createdAt"
  FROM "User"
),
ranked AS (
  SELECT
    "id",
    COALESCE(base, 'user') AS base,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(base, 'user') ORDER BY "createdAt", "id") AS rn
  FROM candidates
)
UPDATE "User" u
SET "username" = CASE WHEN ranked.rn = 1 THEN ranked.base ELSE ranked.base || ranked.rn::text END
FROM ranked
WHERE u."id" = ranked."id";

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
