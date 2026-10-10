package com.example.botfight.service.matchmaking;

import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.MatchEntrant;
import java.util.List;
import java.util.UUID;

/** Authenticated identity and server-selected queue context for one atomic admission. */
public record QueueJoinRequest(UUID userId, String username, String principalName,
        String socketSessionId, MatchMode mode, List<MatchEntrant> requestedGroup,
        UUID partyId, QueuePool pool) {}
