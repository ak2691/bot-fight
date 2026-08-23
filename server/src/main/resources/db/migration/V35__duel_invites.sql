CREATE TABLE duel_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_user_id UUID NOT NULL,
    invitee_user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    match_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT duel_invites_distinct_users_check CHECK (inviter_user_id <> invitee_user_id),
    CONSTRAINT duel_invites_status_check CHECK (
        status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED')
    ),
    CONSTRAINT duel_invites_inviter_fk
        FOREIGN KEY (inviter_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT duel_invites_invitee_fk
        FOREIGN KEY (invitee_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT duel_invites_match_fk
        FOREIGN KEY (match_id)
        REFERENCES matches (id)
        ON DELETE SET NULL
);

CREATE INDEX duel_invites_invitee_status_idx
    ON duel_invites (invitee_user_id, status, expires_at);

CREATE INDEX duel_invites_inviter_status_idx
    ON duel_invites (inviter_user_id, status, expires_at);

CREATE UNIQUE INDEX duel_invites_one_pending_pair_idx
    ON duel_invites (
        LEAST(inviter_user_id, invitee_user_id),
        GREATEST(inviter_user_id, invitee_user_id)
    )
    WHERE status = 'PENDING';
