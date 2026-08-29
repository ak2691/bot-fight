CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL,
    capacity SMALLINT NOT NULL DEFAULT 2,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT parties_capacity_check CHECK (capacity BETWEEN 2 AND 8),
    CONSTRAINT parties_status_check CHECK (status IN ('ACTIVE', 'CLOSED')),
    CONSTRAINT parties_owner_fk
        FOREIGN KEY (owner_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE party_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL,
    user_id UUID NOT NULL,
    slot SMALLINT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT party_members_slot_check CHECK (slot >= 1),
    CONSTRAINT party_members_party_slot_unique UNIQUE (party_id, slot),
    CONSTRAINT party_members_party_user_unique UNIQUE (party_id, user_id),
    CONSTRAINT party_members_party_fk
        FOREIGN KEY (party_id)
        REFERENCES parties (id)
        ON DELETE CASCADE,
    CONSTRAINT party_members_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE party_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL,
    inviter_user_id UUID NOT NULL,
    invitee_user_id UUID NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT party_invites_distinct_users_check CHECK (inviter_user_id <> invitee_user_id),
    CONSTRAINT party_invites_status_check CHECK (
        status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED')
    ),
    CONSTRAINT party_invites_party_fk
        FOREIGN KEY (party_id)
        REFERENCES parties (id)
        ON DELETE CASCADE,
    CONSTRAINT party_invites_inviter_fk
        FOREIGN KEY (inviter_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT party_invites_invitee_fk
        FOREIGN KEY (invitee_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX parties_owner_status_idx ON parties (owner_user_id, status);
CREATE INDEX party_members_party_slot_idx ON party_members (party_id, slot);
CREATE UNIQUE INDEX party_members_one_active_party_idx ON party_members (user_id);
CREATE INDEX party_invites_invitee_status_idx
    ON party_invites (invitee_user_id, status, expires_at);
CREATE INDEX party_invites_party_status_idx
    ON party_invites (party_id, status, expires_at);
CREATE UNIQUE INDEX party_invites_one_pending_member_idx
    ON party_invites (party_id, invitee_user_id)
    WHERE status = 'PENDING';
