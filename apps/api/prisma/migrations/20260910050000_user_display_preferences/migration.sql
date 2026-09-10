-- Currency sign and clock format were only ever stored in the browser's
-- localStorage (see apps/web/src/main.tsx), which is scoped per browser
-- *and* per origin. That's why the setting appeared to "reset to $" on every
-- fresh deploy or new environment: it was never actually saved anywhere the
-- new environment could see it — a brand new browser profile, a different
-- deploy URL, or even just a different browser has its own separate
-- localStorage with nothing in it.
--
-- These two columns bring currency and time format in line with how
-- themePreference already works: saved on the User record, loaded once on
-- login via GET/POST /auth/preferences, and cached into localStorage from
-- there purely so the very frequent money()/formatClockTime() calls stay
-- synchronous. The account, not the browser, is now the source of truth.

ALTER TABLE "User" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "User" ADD COLUMN "timeFormat" TEXT NOT NULL DEFAULT '12h';
