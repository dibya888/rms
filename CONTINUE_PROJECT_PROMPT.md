# RMS Continuation Prompt

You are continuing work on an existing repository at `D:\Project\RMS`.

Read this entire prompt before editing. Inspect the repository before making assumptions. Preserve existing user changes. Do not reset, revert, or overwrite unrelated work.

## Product

This is a multi-tenant Property & Rent Management SaaS. The full product requirements are in the original project brief supplied earlier in the conversation. Preserve the exact business rules from that brief, especially billing, payment status, settlement, dashboard income, and tenant-isolation rules.

## Current Stack

- Backend: Node.js, TypeScript, NestJS 11
- ORM/database: Prisma 6, PostgreSQL
- Current database provider: Neon PostgreSQL
- Frontend: React 19, TypeScript, Vite
- Auth: argon2id, JWT access token, rotating httpOnly refresh cookie
- Validation: class-validator/class-transformer
- Exports: PDFKit and ExcelJS
- Scheduling: @nestjs/schedule
- Testing: Jest and Playwright
- Security: Helmet, CORS allowlist, throttling, CSRF double-submit token, PostgreSQL RLS

## Environment

A local `.env` already exists in the repository workspace. Never print or expose its values. Required keys are:

```env
DATABASE_URL=...
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
```

Other supported keys include `NODE_ENV`, `API_PORT`, `WEB_PORT`, `CORS_ORIGIN`, `REQUIRE_EMAIL_VERIFICATION`, `EMAIL_SINK_PATH`, `STORAGE_PATH`, and `VITE_API_URL`.

The Neon database is already configured and migrated. Do not replace the Neon connection with localhost. Do not ask the user to paste secrets into chat. Read `.env` locally only when needed, without printing secret values.

## Existing Commands

```powershell
npm install
npm run dev
npm run build
npm run lint
npm test --workspace @rms/api
npm run test:e2e
npm run prisma:generate --workspace @rms/api
npm run prisma:migrate --workspace @rms/api
npm exec prisma migrate deploy --workspace @rms/api
npm run prisma:seed --workspace @rms/api
```

Local URLs:

- Frontend: `http://localhost:5173`
- API health/readiness: `http://localhost:3000/health`
- Swagger: `http://localhost:3000/docs`

## Implemented Backend

The API currently includes:

- Auth registration, login, logout, refresh rotation, forgot password, reset password, `/auth/me`
- argon2id password hashing
- Password policy validation
- Persisted hashed refresh sessions
- Hashed, expiring, single-use password reset tokens
- CSRF endpoint and state-changing request protection
- Helmet and configurable CORS
- Auth throttling
- Persisted user light/dark theme preference
- RBAC tables and `SYSTEM_ADMIN` server-side guard
- Admin users and audit-log endpoints
- Owner-scoped property and unit CRUD
- Residential/commercial unit attribute validation
- Tenant creation with active lease and occupied-unit transition
- Move-out, settlement preview, settlement persistence, later settlement update
- Monthly bill generation and scheduled first-of-month generation
- Payment ledger, exact bill-status transitions, receipt numbering, undo latest payment
- Billing defaults propagation to unpaid bills
- Owner-scoped dashboard formulas and recent activity
- Reports: summary, transactions, utilities, outstanding, property income, unit income, tenant income, monthly income, yearly income, repairs
- PDF and Excel transaction exports
- Owner-scoped repairs CRUD and audit events
- Tenant ID-document upload: PDF/JPEG/PNG, maximum 5 MB, local disk storage
- Generated Swagger documentation
- Health endpoint checks PostgreSQL readiness
- Dockerfiles for API and frontend

Important source areas:

- `apps/api/src/auth`
- `apps/api/src/portfolio`
- `apps/api/src/tenancy`
- `apps/api/src/billing`
- `apps/api/src/dashboard`
- `apps/api/src/reports`
- `apps/api/src/repairs`
- `apps/api/src/prisma.service.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/src/main.tsx`
- `apps/web/src/styles.css`

## Database and RLS

Prisma migrations currently include:

1. Foundation schema migration
2. RLS policy migration
3. Forced RLS migration

RLS is deployed to Neon. Business tables use `ownerId = current_setting('app.current_owner_id')::uuid`. The API uses `PrismaService.withOwner(ownerId, callback)` to set the transaction-local PostgreSQL setting. System-admin audit reads use `withSystemAdmin`.

Do not disable RLS or bypass owner filtering. Every service method must continue deriving owner identity from the verified JWT, never from a client-provided owner ID.

`apps/api/prisma/rls.sql` is the rerunnable policy reference. Refresh sessions intentionally remain outside RLS because refresh/logout discover the user only after verifying the signed refresh token.

## Existing Tests

Current test coverage includes:

- Billing total calculation
- All bill status branches: DUE, PARTIAL, LATE, PAID
- All settlement outcomes: REFUND, PAYABLE, SETTLED
- Auth DTO validation
- Live Neon portfolio isolation: owner A cannot read or update owner B property
- Playwright smoke tests for API/web availability and registration page fields

Do not claim full production readiness just because these tests pass. The original brief requires much broader integration and E2E coverage.

## Known Gaps To Complete

Work through these in order, making small focused changes:

1. Add full database-backed cross-tenant isolation tests for properties, units, tenants, leases, bills, payments, repairs, settlements, reports, and every CRUD endpoint.
2. Add authentication integration tests for registration, duplicate email, login failure/success, refresh rotation, reset token single-use behavior, CSRF rejection, throttling, and RBAC 403 behavior.
3. Complete Playwright happy path: register -> login -> property -> unit -> tenant/lease -> generate bill -> partial payment -> final payment -> paid history -> move-out -> settlement.
4. Complete frontend edit/delete/create forms for units, tenants, repairs, billing defaults, and move-out later-settlement actions.
5. Add the missing frontend navigation links and replace any inert buttons with real routes.
6. Add report filters for every required filter and export support for every report type, not only the transaction export.
7. Replace local email sink with a production email-service abstraction and provider implementation.
8. Replace local storage with an S3-compatible storage adapter while keeping the existing storage-service boundary.
9. Add upload content-signature validation and a virus-scan hook before production exposure.
10. Add audit events for every sensitive action listed in the original brief, including exports, bill generation, undo payment, settlement actions, login failures, logout, and role changes.
11. Resolve remaining npm audit findings without using unsafe forced downgrades. Re-evaluate ExcelJS and Prisma versions deliberately.
12. Add production deployment instructions for Neon, API hosting, frontend hosting, secrets, migrations, RLS, storage, email, HTTPS, and backups.
13. Add observability: structured logs, request IDs, safe error responses, and migration/startup diagnostics.
14. Review all acceptance criteria from the original brief and mark each one complete only when code and tests prove it.

## Important Technical Warnings

- Do not run destructive Git commands.
- Do not commit `.env` or display secrets.
- Do not use floating point for money; use Prisma Decimal.
- Do not add previous-balance rollups to bills.
- Do not regenerate paid historical bills.
- Do not modify unpaid bills during move-out.
- Do not delete occupied units.
- Do not allow cross-owner IDOR through nested relations.
- Do not trust frontend guards for admin access.
- Do not make RLS optional in production.
- Do not silently change the specified income formulas.
- Keep database transactions around coupled state changes and their audit events.

## Working Method

1. Inspect the nearest implementation and neighboring tests.
2. State one local hypothesis and one cheap check.
3. Make the smallest focused edit.
4. Run the narrowest useful validation unless the user explicitly asks not to run tests.
5. Do not broaden scope until the focused slice is stable.
6. Report the actual completion percentage and remaining acceptance gaps after each meaningful continuation.

Start by reviewing the current repository state and then take the highest-priority unfinished item from the Known Gaps list. Do not merely propose a plan: implement the next slice.
