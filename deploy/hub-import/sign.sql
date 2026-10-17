-- hub-import: container=ssign-db service=sign
-- What run.sh reads from an older Synergy Hub's SynergySign database: the people who sent or
-- signed something (by email), their documents with signers, fields, audit trail and
-- notifications, and contract events already delivered. The PDFs themselves are on the old app's
-- volume; sign.files.sh sends them. Passwords, sign-in accounts and sessions, plans and billing,
-- affiliate and enterprise records stay behind.
SELECT json_build_object(
  'users', (SELECT coalesce(json_agg(u ORDER BY u."createdAt"), '[]') FROM (
    SELECT id, email, name, "firstName", "lastName", "companyName", "createdAt" FROM users) u),
  'documents', (SELECT coalesce(json_agg(d ORDER BY d."createdAt"), '[]') FROM (
    SELECT id, title, description, "cloudStoragePath", "originalFileName", "fileType", "fileSize", status,
           "signingOrder", deadline, "completedAt", "senderId", summary, "suggestedFields", "createdAt",
           "updatedAt", "aiAnalysis", "aiAnalyzedAt", "aiKeywords", "aiSummary", "aiDetectedAt", "aiFullAnalysis",
           "cloudProvider", archived, "documentHash", "signedAt", "signedDocumentPath", "dealRef", "requestKey"
    FROM documents) d),
  'document_signers', (SELECT coalesce(json_agg(s), '[]') FROM (
    SELECT id, "documentId", "userId", email, name, "order", status, "signedAt", "declinedAt", "reminderCount",
           "lastReminder", "signatureData", "ipAddress", "userAgent", "createdAt", "updatedAt", token, "tokenExpiresAt"
    FROM document_signers) s),
  'document_fields', (SELECT coalesce(json_agg(f), '[]') FROM (
    SELECT id, "documentId", "fieldType", label, required, "pageNumber", x, y, width, height, value, options,
           "createdAt", "updatedAt", "assignedToId", "signerId", "detectionMethod", confidence, "ocrSourceText",
           "originalX", "originalY", "originalWidth", "originalHeight"
    FROM document_fields) f),
  'audit_logs', (SELECT coalesce(json_agg(a), '[]') FROM (
    SELECT id, "documentId", "documentSignerId", "userId", action, details, "ipAddress", "userAgent", "timestamp"
    FROM audit_logs) a),
  'notifications', (SELECT coalesce(json_agg(n), '[]') FROM (
    SELECT id, "documentId", "userId", email, type, status, subject, message, "scheduledFor", "sentAt",
           "errorMessage", "createdAt", "updatedAt", read, "redirectURL"
    FROM notifications) n),
  'contract_event_outbox', (SELECT coalesce(json_agg(o), '[]') FROM (
    SELECT id, ref, "documentId", payload, attempts, "nextAttemptAt", "deliveredAt", "failedAt", "lastStatus",
           "lastError", "createdAt", "updatedAt"
    FROM contract_event_outbox) o)
);
