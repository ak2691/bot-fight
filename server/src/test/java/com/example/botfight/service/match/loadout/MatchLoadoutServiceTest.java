package com.example.botfight.service.match.loadout;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchLoadoutServiceTest {
    private final MatchLoadoutService service = new MatchLoadoutService(new JsonMapper());

    @Test
    void completesASelectionWithoutSortingItsAbilityCodes() {
        UUID userId = UUID.nameUUIDFromBytes("loadout-order-user".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("loadout-order-match".getBytes()),
                99L,
                List.of(new MatchPlayer(
                        userId, "One", "one", 1, false, null, 0, "custom:", false)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(),
                Map.of());
        MatchPlayer player = session.players().getFirst();
        List<Integer> offers = service.abilityOffers(session);
        String selectedCodes = offers.subList(0, 3).stream()
                .map(CompactAbilityCode::codeForId)
                .reduce("", (current, code) -> code + current);

        assertThat(service.completeRoundAbilityDraft(session, player, "custom:" + selectedCodes))
                .isEqualTo("custom:" + selectedCodes);
    }

    @Test
    void retainsPriorRoundCodesBeforeNewRoundCodes() {
        UUID userId = UUID.nameUUIDFromBytes("loadout-round-two-user".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("loadout-round-two-match".getBytes()),
                99L,
                List.of(new MatchPlayer(
                        userId, "One", "one", 1, false, null, 0, "custom:psg", false)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                2,
                1,
                List.of(),
                Map.of());
        MatchPlayer player = session.players().getFirst();
        List<Integer> offers = service.abilityOffers(session);
        String newCodes = offers.subList(0, 2).stream()
                .map(CompactAbilityCode::codeForId)
                .reduce("", (current, code) -> code + current);

        assertThat(service.completeRoundAbilityDraft(session, player, "custom:" + newCodes + "psg"))
                .isEqualTo("custom:psg" + newCodes);
    }
}
