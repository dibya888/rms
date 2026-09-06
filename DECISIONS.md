# Decisions

- Payment undo removes the most recent payment by `paidOn` and recomputes the bill from the remaining ledger rows.
- Refresh tokens are persisted as argon2id hashes in `RefreshSession` so rotation and revocation are enforceable server-side.
- The local API connects to PostgreSQL during startup. Run `docker compose up -d postgres` before starting the API.
- Docker is not available in the current development environment, so Prisma migrations and database-backed integration tests must run in an environment with PostgreSQL available.
