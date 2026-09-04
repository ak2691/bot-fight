package com.example.botfight.service.match.loadout;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        assertThat(offers).hasSize(6);
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
        assertThat(offers).hasSize(4);
        String newCodes = offers.subList(0, 2).stream()
                .map(CompactAbilityCode::codeForId)
                .reduce("", (current, code) -> code + current);

        assertThat(service.completeRoundAbilityDraft(session, player, "custom:" + newCodes + "psg"))
                .isEqualTo("custom:psg" + newCodes);
    }

    @Test
    void givesEachPlayerTheirGuaranteeAndTheSameCommonRandomOffers() {
        UUID firstUserId = UUID.nameUUIDFromBytes("guarantee-first".getBytes());
        UUID secondUserId = UUID.nameUUIDFromBytes("guarantee-second".getBytes());
        MatchSession session = new MatchSession(
                UUID.nameUUIDFromBytes("guarantee-match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, false, null, 0, "custom:", false),
                        new MatchPlayer(secondUserId, "Two", "two", 2, false, null, 0, "custom:", false)),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                Instant.now(),
                1,
                1,
                List.of(),
                Map.of(),
                null,
                null,
                null,
                null,
                false,
                MatchMode.ONES,
                300,
                Set.of(),
                Map.of(firstUserId, Map.of(1, 1, 2, 6, 3, 21),
                        secondUserId, Map.of(1, 3, 2, 8, 3, 22)));

        List<Integer> firstOffers = service.abilityOffersForPlayer(session, firstUserId);
        List<Integer> secondOffers = service.abilityOffersForPlayer(session, secondUserId);

        assertThat(firstOffers).hasSize(6).contains(1).doesNotContain(3);
        assertThat(secondOffers).hasSize(6).contains(3).doesNotContain(1);
        assertThat(firstOffers).containsExactlyInAnyOrderElementsOf(
                secondOffers.stream()
                        .map(abilityId -> abilityId.equals(3) ? 1 : abilityId)
                        .toList());
    }

    @Test
    void preservesEmptyGuaranteeSlotsAndRejectsWrongRoundAbilities() {
        Map<Integer, Integer> guarantees = MatchLoadoutService.normalizeAbilityGuarantees(
                Arrays.asList(1, null, 21));

        assertThat(guarantees)
                .containsEntry(1, 1)
                .containsEntry(3, 21)
                .doesNotContainKey(2);
        assertThatThrownBy(() -> MatchLoadoutService.normalizeAbilityGuarantees(List.of(6)))
                .isInstanceOf(com.example.botfight.service.auth.AuthException.class);
    }
}
