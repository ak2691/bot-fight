package com.example.botfight.service.match;


import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.match.MatchTimingPolicy;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchLoadoutServiceTest {
    private static final List<Integer> TIER_ONE = List.of(3, 4, 5, 7, 9, 10, 11, 12, 26, 28, 29);
    private static final List<Integer> TIER_TWO = List.of(6, 8, 13, 14, 15, 16, 17, 18, 25, 30, 31, 32);
    private static final List<Integer> TIER_THREE = List.of(21, 22, 23, 24, 27, 33);

    private final MatchLoadoutService service = new MatchLoadoutService(new JsonMapper());
    private final UUID firstUserId = UUID.nameUUIDFromBytes("loadout-first".getBytes());
    private final UUID secondUserId = UUID.nameUUIDFromBytes("loadout-second".getBytes());

    private MatchSession session(int round, String firstLoadout, String secondLoadout) {
        Instant now = Instant.parse("2026-10-04T12:00:00Z");
        return new MatchSession(
                UUID.nameUUIDFromBytes("loadout-match".getBytes()),
                99L,
                List.of(
                        new MatchPlayer(firstUserId, "One", "one", 1, 1 <= 2 ? 1 : 1, false, null, 0, firstLoadout, false, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null),
                        new MatchPlayer(secondUserId, "Two", "two", 2, 2 <= 2 ? 2 : 1, false, null, 0, secondLoadout, false, MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS * 1_000L, MatchPlayer.TIMEOUT_FALLBACK_CURRENT, null)),
                now,
                now,
                now,
                round,
                null,
                null,
                null,
                null,
                false,
                MatchMode.ONES,
                MatchTimingPolicy.ONES_BASE_CLOCK_SECONDS,
                MatchTimingPolicy.DEFAULT_INCREMENT_SECONDS,
                Set.of(),
                List.of(), com.example.botfight.service.match.state.MatchPhase.BUILDING);
    }

    private MatchPlayer first(MatchSession session) {
        return session.players().get(0);
    }

    private static String code(int abilityId) {
        return AbilityCatalog.codeForId(abilityId);
    }

    @Test
    void tiersMapToRoundsTwoAtATimeAndTheWeaponPickIsRoundOneOnly() {
        assertThat(List.of(1, 2, 3, 4, 5, 6).stream().map(MatchLoadoutService::tierForRound))
                .containsExactly(1, 1, 2, 2, 3, 3);
        assertThat(MatchLoadoutService.requiredPicks(1)).isEqualTo(2);
        assertThat(List.of(2, 3, 4, 5, 6).stream().map(MatchLoadoutService::requiredPicks)).containsOnly(1);
        assertThat(MatchLoadoutService.WEAPON_IDS).containsExactly(1, 35, 36, 37);
        assertThat(service.weaponOffers(session(1, "custom:", "custom:"))).containsExactly(1, 35, 36, 37);
        assertThat(service.weaponOffers(session(2, "custom:s", "custom:s"))).isEmpty();
    }

    @Test
    void offersComeFromTheRoundsTierAndAreSharedByEveryPlayer() {
        for (int round = 1; round <= 6; round++) {
            MatchSession session = session(round, "custom:", "custom:");
            List<Integer> offers = service.abilityOffersForPlayer(session, firstUserId);
            List<Integer> tier = round <= 2 ? TIER_ONE : round <= 4 ? TIER_TWO : TIER_THREE;

            assertThat(offers).as("round %d offers", round).hasSize(round >= 5 ? 2 : 3)
                    .doesNotHaveDuplicates().isSubsetOf(tier);
            // Slash is a weapon now, not an offered ability.
            assertThat(offers).doesNotContain(1);
            assertThat(service.abilityOffersForPlayer(session, secondUserId)).isEqualTo(offers);
            // Deterministic from the seed and round.
            assertThat(service.abilityOffersForPlayer(session, firstUserId)).isEqualTo(offers);
        }
    }

    @Test
    void anOwnedAbilityIsNeverOfferedAgainButEveryoneElseKeepsTheSharedOffers() {
        MatchSession fresh = session(2, "custom:", "custom:");
        List<Integer> shared = service.abilityOffersForPlayer(fresh, firstUserId);
        int owned = shared.getFirst();

        MatchSession ownsOne = session(2, "custom:s" + code(owned), "custom:");
        List<Integer> firstOffers = service.abilityOffersForPlayer(ownsOne, firstUserId);
        List<Integer> secondOffers = service.abilityOffersForPlayer(ownsOne, secondUserId);

        assertThat(firstOffers).hasSize(3).doesNotContain(owned);
        assertThat(secondOffers).isEqualTo(shared);
        // The next offer in the shared order takes the owned one's place.
        assertThat(firstOffers).containsAll(shared.subList(1, 3));
    }

    @Test
    void roundOnePicksOneWeaponAndOneOfferedAbilityAndKeepsTheWeaponFirst() {
        MatchSession session = session(1, "custom:", "custom:");
        int offer = service.abilityOffersForPlayer(session, firstUserId).get(1);

        // The client may send them in any order; the weapon is acquired first.
        String completed = service.completeRoundAbilityDraft(session, first(session), "custom:" + code(offer) + "y");

        assertThat(completed).isEqualTo("custom:y" + code(offer));
        service.validateRoundAbilityDraft(session, first(session), completed);
    }

    @Test
    void aRoundOneTimeoutAutoPicksSlashAndTheFirstOffer() {
        MatchSession session = session(1, "custom:", "custom:");
        int firstOffer = service.abilityOffersForPlayer(session, firstUserId).getFirst();

        assertThat(service.completeRoundAbilityDraft(session, first(session), "custom:"))
                .isEqualTo("custom:s" + code(firstOffer));
        // A weapon alone gets the first offer; an ability alone gets Slash.
        assertThat(service.completeRoundAbilityDraft(session, first(session), "custom:z"))
                .isEqualTo("custom:z" + code(firstOffer));
        int second = service.abilityOffersForPlayer(session, firstUserId).get(1);
        assertThat(service.completeRoundAbilityDraft(session, first(session), "custom:" + code(second)))
                .isEqualTo("custom:s" + code(second));

        MatchSession timedOut = service.withDefaultAbilitySelections(session);
        assertThat(timedOut.players()).allMatch(MatchPlayer::loadoutSelected);
        assertThat(timedOut.players().get(0).selectedLoadout()).isEqualTo("custom:s" + code(firstOffer));
        assertThat(timedOut.players().get(1).selectedLoadout()).isEqualTo("custom:s" + code(firstOffer));
    }

    @Test
    void laterRoundsPickOneOfferAndATimeoutTakesTheFirstOffer() {
        MatchSession round3 = session(3, "custom:sg", "custom:sg");
        List<Integer> offers = service.abilityOffersForPlayer(round3, firstUserId);

        assertThat(service.completeRoundAbilityDraft(round3, first(round3), "custom:sg"))
                .isEqualTo("custom:sg" + code(offers.getFirst()));
        String picked = service.completeRoundAbilityDraft(round3, first(round3), "custom:" + code(offers.get(2)) + "sg");
        assertThat(picked).isEqualTo("custom:sg" + code(offers.get(2)));
        service.validateRoundAbilityDraft(round3, first(round3), picked);
    }

    @Test
    void theWeaponAndOfferAllowlistsAreEnforcedOnTheServer() {
        MatchSession round1 = session(1, "custom:", "custom:");
        MatchSession round2 = session(2, "custom:s" + code(service.abilityOffersForPlayer(
                session(1, "custom:", "custom:"), firstUserId).getFirst()), "custom:s");
        List<Integer> round1Offers = service.abilityOffersForPlayer(round1, firstUserId);
        int notOffered = TIER_ONE.stream().filter(id -> !round1Offers.contains(id)).findFirst().orElseThrow();
        List<Integer> round2Offers = service.abilityOffersForPlayer(round2, firstUserId);

        // An ability outside the round's offers, and a tier 2 ability in a tier 1 round.
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round1, first(round1), "custom:s" + code(notOffered)))
                .isInstanceOf(AuthException.class);
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round1, first(round1), "custom:s" + code(6)))
                .isInstanceOf(AuthException.class);
        // Two weapons, or an ability that is not a weapon posing as one.
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round1, first(round1), "custom:sy"))
                .isInstanceOf(AuthException.class);
        // A weapon after round 1.
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round2, first(round2), first(round2).selectedLoadout() + "y"))
                .isInstanceOf(AuthException.class);
        // Dropping a prior pick, more than one pick, or an ability already owned.
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round2, first(round2), "custom:" + code(round2Offers.getFirst())))
                .isInstanceOf(AuthException.class);
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round2, first(round2),
                first(round2).selectedLoadout() + code(round2Offers.get(0)) + code(round2Offers.get(1))))
                .isInstanceOf(AuthException.class);
        assertThatThrownBy(() -> service.completeRoundAbilityDraft(round2, first(round2), "custom:" + "ss"))
                .isInstanceOf(AuthException.class);
        // Validation of a finished pick is exact: a missing pick is rejected too.
        assertThatThrownBy(() -> service.validateRoundAbilityDraft(round2, first(round2), first(round2).selectedLoadout()))
                .isInstanceOf(AuthException.class);
        assertThatThrownBy(() -> service.validateRoundAbilityDraft(round1, first(round1), "custom:s"))
                .isInstanceOf(AuthException.class);
    }

    @Test
    void sixRoundsBuildAWeaponPlusSixAbilitiesWithoutRepeats() {
        String loadout = "custom:";
        List<String> history = new ArrayList<>();
        for (int round = 1; round <= 6; round++) {
            MatchSession session = session(round, loadout, "custom:");
            String next = service.completeRoundAbilityDraft(session, first(session), loadout);
            service.validateRoundAbilityDraft(session, first(session), next);

            assertThat(next).startsWith(loadout);
            assertThat(next.length() - "custom:".length()).isEqualTo(round + 1);
            loadout = next;
            history.add(loadout);
        }
        String codes = loadout.substring("custom:".length());
        assertThat(codes).hasSize(7);
        assertThat(codes.chars().distinct().count()).isEqualTo(7);
        assertThat(codes.charAt(0)).isEqualTo('s');
        assertThat(service.normalize(loadout)).isEqualTo(loadout);
        assertThat(service.normalize("custom:abcdefgh")).isEqualTo("melee");
    }
}
