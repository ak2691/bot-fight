package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchPhase;
import com.example.botfight.service.match.state.MatchRuntimeState;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchRuntimeStateTest {
    private final MatchRuntimeState state = new MatchRuntimeState(new com.example.botfight.service.match.MatchPhaseService());

    private MatchSession session(UUID first, UUID second) {
        return new MatchSession(UUID.randomUUID(), 42, List.of(
                new MatchPlayer(first, "one", first.toString(), 1, 1, false, null, 0, "custom:", false,
                        300_000, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null),
                new MatchPlayer(second, "two", second.toString(), 2, 2, false, null, 0, "custom:", false,
                        300_000, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null)),
                null, null, null, 1, null, null, null, null, false, MatchMode.ONES,
                300, 30, Set.of(), List.of(), MatchPhase.MATCH_FOUND);
    }

    @Test
    void everyIndexReadsTheSameReplacementSessionAndRemovalClearsThem() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        MatchSession initial = session(first, second);
        UUID reservation = state.reserveMatchStart(List.of(first, second));
        assertThat(state.publishReservedSession(reservation, initial)).isTrue();
        assertThat(state.isMatchStartReserved(first)).isFalse();
        MatchSession updated = initial.withLoadoutSelection(Instant.now().plusSeconds(30));
        state.putSession(updated);
        assertThat(state.activeSessionForUser(first)).isSameAs(updated);
        assertThat(state.activeSessionForUser(second)).isSameAs(updated);
        assertThat(state.activeSessionForPrincipal(first.toString())).isSameAs(updated);
        assertThat(state.activeSessionForMatch(initial.matchId())).isSameAs(updated);
        assertThat(state.distinctActiveSessions()).containsExactly(updated);
        state.removeSession(updated);
        assertThat(state.activeSessionForUser(first)).isNull();
        assertThat(state.activeSessionForPrincipal(first.toString())).isNull();
        assertThat(state.activeSessionForMatch(initial.matchId())).isNull();
        assertThat(state.reserveMatchStart(List.of(first, second))).isNotNull();
    }

    @Test
    void leavingOneParticipantDoesNotResurrectTheirIndexOnResultReveal() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        MatchSession initial = session(first, second);
        state.putSession(initial);
        state.removeUser(first);
        state.putSession(initial.resultReady());
        assertThat(state.activeSessionForUser(first)).isNull();
        assertThat(state.activeSessionForPrincipal(first.toString())).isNull();
        assertThat(state.activeSessionForUser(second).phase()).isEqualTo(MatchPhase.RESULT_READY);
        state.removeUser(second);
        assertThat(state.activeSessionForMatch(initial.matchId())).isNull();
    }

    @Test
    void oldCleanupCannotRemoveAParticipantFromTheirNewMatch() {
        UUID first = UUID.randomUUID();
        MatchSession old = session(first, UUID.randomUUID());
        state.putSession(old);
        state.removeSession(old);
        MatchSession next = session(first, UUID.randomUUID());
        state.putSession(next);
        state.removeSession(old);
        assertThat(state.activeSessionForUser(first)).isSameAs(next);
        assertThat(state.activeSessionForPrincipal(first.toString())).isSameAs(next);
    }

    @Test
    void reservationMustPublishItsExactRosterAndCanBeReleasedForRetry() {
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        UUID reservation = state.reserveMatchStart(List.of(first, second));
        assertThat(state.reserveMatchStart(List.of(first, UUID.randomUUID()))).isNull();
        assertThat(state.publishReservedSession(reservation, session(first, UUID.randomUUID()))).isFalse();
        state.releaseMatchStart(reservation);
        assertThat(state.isMatchStartReserved(first)).isFalse();
        assertThat(state.isMatchStartReserved(second)).isFalse();
        assertThat(state.reserveMatchStart(List.of(first, second))).isNotNull();
    }
}
