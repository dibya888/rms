CREATE TABLE "ActivationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivationToken_userId_idx" ON "ActivationToken"("userId");
CREATE INDEX "ActivationToken_expiresAt_idx" ON "ActivationToken"("expiresAt");

ALTER TABLE "ActivationToken" ADD CONSTRAINT "ActivationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;