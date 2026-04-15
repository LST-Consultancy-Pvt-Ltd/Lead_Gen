-- CreateTable
CREATE TABLE "PasswordResetOtp" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "resetToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetOtp_email_key" ON "PasswordResetOtp"("email");
