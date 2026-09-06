# Property & Rent Management System

A multi-tenant property and rent management system built with NestJS, PostgreSQL/Prisma, and React/Vite.

## Prerequisites

- Node.js 22+
- npm 11+
- PostgreSQL 16+ (required from Phase 2 onward)

## Development

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The API readiness endpoint is available at `http://localhost:3000/health` and reports both API and PostgreSQL status. The web app is available at `http://localhost:5173`.

Generated OpenAPI documentation is available at `http://localhost:3000/docs` while the API is running.

Reports are available under `/reports`: `summary`, `transactions`, `utilities`, `outstanding`, `income/property`, `income/unit`, `income/tenant`, `income/monthly`, `income/yearly`, and `repairs`. All report endpoints accept the shared date, property, unit, tenant, and status filters where applicable.

Production startup requires `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`; the API fails fast when any is missing. Run `npm run prisma:migrate --workspace @rms/api` for development or `npm exec prisma migrate deploy --workspace @rms/api` for deployment.

Container images are defined in `apps/api/Dockerfile` and `apps/web/Dockerfile`. Build them from the repository root with `docker build -f apps/api/Dockerfile -t rms-api .` and `docker build -f apps/web/Dockerfile -t rms-web .`. Supply the API environment variables at runtime; do not bake `.env` into an image.

Tenant ID documents accept PDF, JPEG, or PNG files up to 5 MB and are stored under `STORAGE_PATH` in development. Production should provide an S3-compatible storage adapter before exposing uploads publicly.

Authentication endpoints are under `/auth`: registration, login, refresh-cookie rotation, logout, forgot-password/reset-password, and the protected `/auth/me` probe. In development, reset messages are appended to `EMAIL_SINK_PATH`; production should replace that sink with a real mail provider. PostgreSQL must be running before starting the API because Prisma connects during application startup.

To initialize the database when Docker/PostgreSQL is available:

```powershell
docker compose up -d postgres
Copy-Item .env.example .env
npm run prisma:migrate --workspace @rms/api -- --name foundation
npm run prisma:seed --workspace @rms/api
# Apply apps/api/prisma/rls.sql with the same database role after migration.
```

`apps/api/prisma/rls.sql` enables PostgreSQL Row-Level Security for business tables. The API must set the transaction-local `app.current_owner_id` from the verified JWT before production traffic is enabled.

## Production deployment checklist

1. Create a Neon production branch and store `DATABASE_URL` as a secret in the API host. Use the pooled URL for runtime traffic and run `prisma migrate deploy` during release using the direct URL when the host supports a separate `DIRECT_URL` secret.
2. Run `npm ci`, `npm run prisma:generate --workspace @rms/api`, and `npm exec prisma migrate deploy --workspace @rms/api` in the release environment. Never run `migrate dev` against production.
3. Configure `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`, `NODE_ENV=production`, `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_TOKEN`, `EMAIL_FROM`, `S3_BUCKET`, `S3_REGION`, and the S3 credentials. Set `VIRUS_SCAN_URL` when uploads are enabled.
4. Deploy the API behind HTTPS and a reverse proxy. Forward the `x-request-id` response/request header and expose only `/health` as the readiness probe. The endpoint must return HTTP 200 with `database: connected` before accepting traffic.
5. Deploy the web build with `VITE_API_URL` set to the HTTPS API origin. Restrict `CORS_ORIGIN` to that exact web origin and enable secure cookies.
6. Apply `apps/api/prisma/rls.sql` with the production database role and verify forced RLS remains enabled after migrations. Keep database backups and point-in-time recovery enabled in Neon.
7. Store S3 objects privately, serve them through short-lived signed access paths, configure lifecycle retention, and monitor failed upload/scanning events. Do not expose local `STORAGE_PATH` as a production volume.
8. Send application logs and request IDs to the hosting provider’s log service, alert on readiness failures, repeated authentication failures, migration errors, and storage/email provider failures.

## Build

```powershell
npm run build
```

Implementation follows the phased requirements in the project brief. Database migrations, authentication, tenant isolation, and domain workflows are introduced incrementally with tests.
