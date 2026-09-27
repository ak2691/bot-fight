CREATE TABLE chat_message_evidence (
    message_id UUID PRIMARY KEY,
    context_type VARCHAR(24) NOT NULL,
    context_id UUID NOT NULL,
    sender_user_id UUID NOT NULL,
    sender_username VARCHAR(20) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    normalized_text VARCHAR(280) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    moderation_metadata VARCHAR(500)
);

CREATE TABLE chat_message_evidence_recipients (
    message_id UUID NOT NULL REFERENCES chat_message_evidence(message_id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX chat_message_evidence_expiry_idx ON chat_message_evidence (expires_at);
CREATE INDEX chat_message_evidence_context_idx ON chat_message_evidence (context_type, context_id, sent_at);
CREATE INDEX chat_message_evidence_recipient_user_idx ON chat_message_evidence_recipients (user_id, message_id);

CREATE TABLE chat_reports (
    report_id UUID PRIMARY KEY,
    reporter_user_id UUID NOT NULL,
    reporter_username VARCHAR(20) NOT NULL,
    message_id UUID NOT NULL,
    reason VARCHAR(32) NOT NULL,
    report_note VARCHAR(300),
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolver_user_id UUID,
    resolver_username VARCHAR(20),
    resolution_note VARCHAR(500),
    evidence_context_type VARCHAR(24) NOT NULL,
    evidence_context_id UUID NOT NULL,
    evidence_sender_user_id UUID NOT NULL,
    evidence_sender_username VARCHAR(20) NOT NULL,
    evidence_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    evidence_text VARCHAR(280) NOT NULL,
    CONSTRAINT chat_reports_reporter_message_unique UNIQUE (reporter_user_id, message_id)
);

CREATE INDEX chat_reports_status_created_idx ON chat_reports (status, created_at DESC);
CREATE INDEX chat_reports_resolved_retention_idx ON chat_reports (resolved_at) WHERE resolved_at IS NOT NULL;

CREATE TABLE chat_report_recipients (
    report_id UUID NOT NULL REFERENCES chat_reports(report_id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    PRIMARY KEY (report_id, user_id)
);

CREATE TABLE chat_moderation_audit (
    audit_id UUID PRIMARY KEY,
    report_id UUID NOT NULL,
    actor_user_id UUID,
    actor_username VARCHAR(20),
    action VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    detail VARCHAR(160)
);

CREATE INDEX chat_moderation_audit_report_idx ON chat_moderation_audit (report_id, created_at);
