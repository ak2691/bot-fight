package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.MatchPhase;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchSessionPhaseTest {
    private final Instant now = Instant.parse("2026-10-09T12:00:00Z");
    private final UUID first = UUID.randomUUID();
    private final UUID second = UUID.randomUUID();

    private MatchSession initial() {
        return new MatchSession(UUID.randomUUID(), 42, List.of(
                new MatchPlayer(first, "one", "one", 1, 1, false, null, 0, "custom:", false,
                        300_000, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null),
                new MatchPlayer(second, "two", "two", 2, 2, false, null, 0, "custom:", false,
                        300_000, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null)),
                null, null, null, 1, null, null, null, null, false, MatchMode.ONES,
                300, 30, Set.of(), List.of(), MatchPhase.MATCH_FOUND);
    }

    private MatchSession building() { return initial().withLoadoutSelection(now.plusSeconds(32)).withCountdown(now); }
    private MatchSession finished() {
        return building().withFinishedPlayer(first, UUID.randomUUID(), now)
                .withFinishedPlayer(second, UUID.randomUUID(), now);
    }
    private MatchSession replay(boolean ended) {
        return finished().simulating().withReplay(null, now.plusSeconds(3), now.plusSeconds(23), now.plusSeconds(26), ended);
    }
    private void assertPhase(MatchSession session, MatchPhase phase, String status) {
        assertThat(session.phase()).isEqualTo(phase);
        assertThat(session.phase().wireStatus()).isEqualTo(status);
    }

    @Test void pick() { assertPhase(initial().withLoadoutSelection(now.plusSeconds(32)), MatchPhase.KIT_REVEAL, "KIT_REVEAL"); }
    @Test void build() { assertPhase(building(), MatchPhase.BUILDING, "PREP"); }
    @Test void oneFinishedKeepsBuilding() { assertPhase(building().withFinishedPlayer(first, UUID.randomUUID(), now), MatchPhase.BUILDING, "PREP"); }
    @Test void allFinished() { assertPhase(finished(), MatchPhase.SIMULATION_LOADING, "SIMULATION_LOADING"); }
    @Test void simulating() { assertPhase(finished().simulating(), MatchPhase.SIMULATING, "SIMULATION_LOADING"); }
    @Test void retry() { assertPhase(finished().simulating().simulationFailed(), MatchPhase.SIMULATION_LOADING, "SIMULATION_LOADING"); }
    @Test void replay() { assertPhase(replay(false), MatchPhase.REPLAY, "SIMULATION_PREPARING"); }
    @Test void nextPick() {
        MatchSession next = replay(false).nextRound().withCountdown(now.plusSeconds(26));
        assertPhase(next, MatchPhase.BUILDING, "PREP");
        assertThat(next.players()).allSatisfy(player -> {
            assertThat(player.loadoutSelected()).isTrue();
            assertThat(player.finished()).isFalse();
            assertThat(player.clockRemainingMs()).isEqualTo(375_000);
        });
    }
    @Test void result() { assertPhase(replay(true).resultReady(), MatchPhase.RESULT_READY, "RESULT_READY"); }
    @Test void invalidTransition() { assertThatThrownBy(() -> initial().simulating()).isInstanceOf(IllegalStateException.class); }
}
