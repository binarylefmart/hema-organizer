-- CreateIndex
CREATE INDEX "AuditLog_action_date_idx" ON "AuditLog"("action", "date");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
