-- Audit history must survive account deletion: make actorUserId nullable
-- and switch its FK from RESTRICT to SET NULL so deleting a user doesn't
-- get blocked by (and doesn't erase) their own past audit trail.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorUserId_fkey";
ALTER TABLE "AuditLog" ALTER COLUMN "actorUserId" DROP NOT NULL;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "AuditAction" ADD VALUE 'USER_DELETED';
