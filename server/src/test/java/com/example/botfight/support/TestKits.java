package com.example.botfight.support;
import com.example.botfight.service.match.model.MatchEntrant;
import com.example.botfight.service.matchmaking.QueueJoinRequest;
import com.example.botfight.service.matchmaking.QueuePool;
import com.example.botfight.domain.match.MatchMode;
import java.util.List;
import java.util.UUID;
public final class TestKits {
    public static final String KIT = com.example.botfight.service.match.MatchLoadoutService.validateKit(
        new com.example.botfight.DTO.match.MatchKitDTO(1, List.of(3, 6, 22)));
    public static MatchEntrant entrant(UUID id, String username, String principal, String socket) {
        return new MatchEntrant(id, username, principal, socket, 0, KIT);
    }
    public static MatchEntrant entrant(UUID id, String username, String principal, String socket, int team) {
        return new MatchEntrant(id, username, principal, socket, team, KIT);
    }
    public static QueueJoinRequest queue(UUID id, String username, String principal, String socket,
            MatchMode mode, List<MatchEntrant> group, UUID party, QueuePool pool) {
        return new QueueJoinRequest(id, username, principal, socket, mode,
            group == null ? List.of(entrant(id, username, principal, socket)) : group, party, pool);
    }
}
