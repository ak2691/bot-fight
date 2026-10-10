package com.example.botfight.service.match;

import org.springframework.stereotype.Component;

import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Validates and deterministically completes the pick for each round of a timed-rounds match.
 *
 * <p>Round 1 picks a weapon (any of {@link #WEAPON_IDS}) and one ability. Rounds 2 to 6 pick one
 * ability each. Offers come from the match seed, are the same for every player, and never include an
 * ability the player already owns.
 */
@Component
public final class MatchLoadoutService {
    /** The weapon pick of round 1. All weapons are melee; Slash is the timeout default. */
    public static final List<Integer> WEAPON_IDS = List.of(1, 35, 36, 37);
    public static final int DEFAULT_WEAPON_ID = 1;
    /** A weapon plus one ability per round. */
    private static final int MAX_EQUIPPED_ABILITIES = 1 + MatchTimingPolicy.MAX_ROUNDS;
    /** Ability pools by tier; rounds 1-2 use tier 1, 3-4 tier 2, and 5-6 tier 3. Slash is a weapon now. */
    private static final Map<Integer, List<Integer>> TIER_ABILITIES = Map.of(
            1, List.of(3, 4, 5, 7, 9, 10, 11, 12, 26, 28, 29),
            2, List.of(6, 8, 13, 14, 15, 16, 17, 18, 25, 30, 31, 32),
            3, List.of(21, 22, 23, 24, 27, 33));
    private static final Map<Integer, Integer> TIER_OFFER_COUNTS = Map.of(1, 3, 2, 3, 3, 2);
    private final JsonMapper jsonMapper;

    public MatchLoadoutService(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    /** Rounds map to tiers two at a time: 1-2 -> 1, 3-4 -> 2, 5-6 -> 3. */
    public static int tierForRound(int roundNumber) {
        return Math.max(1, Math.min(3, (Math.max(1, roundNumber) + 1) / 2));
    }

    /** How many new abilities (including the round 1 weapon) a round's pick must add. */
    public static int requiredPicks(int roundNumber) {
        return roundNumber <= 1 ? 2 : 1;
    }

    public String normalize(String selectedLoadout) {
        if (selectedLoadout != null
                && selectedLoadout.matches("custom:[A-Za-z0-9]{0," + MAX_EQUIPPED_ABILITIES + "}")) {
            return selectedLoadout;
        }
        if ("custom".equals(selectedLoadout)) return "custom";
        if ("ranged".equals(selectedLoadout)) return "ranged";
        if ("mage".equals(selectedLoadout)) return "mage";
        return "melee";
    }

    public String submissionLoadoutId(BotSubmission submission) {
        if (submission == null || submission.getBrainPayload() == null) return null;
        try {
            JsonNode loadout = jsonMapper.readTree(submission.getBrainPayload()).path("loadout");
            if (!loadout.isObject()) return null;
            List<String> selectedCodes = new ArrayList<>();
            loadout.path("abilities").forEach(ability -> {
                String code = ability.isIntegralNumber() && ability.canConvertToInt()
                        ? AbilityCatalog.codeForId(ability.intValue())
                        : null;
                if (code != null) selectedCodes.add(code);
            });
            return "custom:" + String.join("", selectedCodes);
        } catch (Exception ignored) {
            return null;
        }
    }

    public ObjectNode encodedLoadoutNode(String selectedLoadout) {
        if (selectedLoadout == null || !selectedLoadout.startsWith("custom:")) return null;
        String[] parts = selectedLoadout.split(":", -1);
        if (parts.length != 2) return null;

        ObjectNode loadout = jsonMapper.createObjectNode();
        var abilityArray = loadout.putArray("abilities");
        for (int index = 0; index < parts[1].length(); index++) {
            Integer abilityId = AbilityCatalog.idForCode(
                    String.valueOf(parts[1].charAt(index)));
            if (abilityId != null) abilityArray.add(abilityId);
        }
        return loadout;
    }

    /** Validates a finished pick: it keeps every prior ability and adds exactly this round's picks. */
    public void validateRoundAbilityDraft(
            MatchSession session,
            MatchPlayer player,
            String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return;
        Draft draft = draft(session, player, nextLoadout);
        int required = requiredPicks(session.roundNumber());
        if (!draft.valid() || draft.addedCodes().size() != required) {
            throw new AuthException(
                    "bot loadout must retain prior abilities and choose exactly "
                            + required + " from this round's weapon and ability offers");
        }
    }

    /**
     * Completes a possibly partial pick. Anything the player did not pick is chosen for them: Slash if
     * no weapon was picked in round 1, then the first offers in offer order.
     */
    public String completeRoundAbilityDraft(
            MatchSession session,
            MatchPlayer player,
            String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return nextLoadout;
        Draft draft = draft(session, player, nextLoadout);
        int required = requiredPicks(session.roundNumber());
        if (!draft.valid() || draft.addedCodes().size() > required) {
            throw new AuthException(
                    "bot loadout must retain prior abilities and choose up to "
                            + required + " from this round's weapon and ability offers");
        }

        LinkedHashSet<String> added = new LinkedHashSet<>(draft.addedCodes());
        if (session.roundNumber() <= 1 && added.stream().noneMatch(MatchLoadoutService::isWeaponCode)) {
            added.add(AbilityCatalog.codeForId(DEFAULT_WEAPON_ID));
        }
        if (added.size() < required) {
            Set<String> taken = new LinkedHashSet<>(draft.previousCodes());
            taken.addAll(added);
            for (Integer offer : abilityOffersForPlayer(session, player.userId())) {
                if (added.size() >= required) break;
                String code = AbilityCatalog.codeForId(offer);
                if (code != null && !taken.contains(code)) added.add(code);
            }
        }

        // Acquisition order is the match and replay presentation order: prior picks first, and in
        // round 1 the weapon before the ability.
        StringBuilder ordered = new StringBuilder(String.join("", draft.previousCodes()));
        added.stream().filter(MatchLoadoutService::isWeaponCode).forEach(ordered::append);
        added.stream().filter(code -> !isWeaponCode(code)).forEach(ordered::append);
        return "custom:" + ordered;
    }

    /** The weapons a player may pick in round 1; empty in every later round. */
    public List<Integer> weaponOffers(MatchSession session) {
        return session.roundNumber() <= 1 ? WEAPON_IDS : List.of();
    }

    public List<Integer> abilityOffers(MatchSession session) {
        UUID recipientUserId = session.players().isEmpty() ? null : session.players().get(0).userId();
        return abilityOffersForPlayer(session, recipientUserId);
    }

    /**
     * The offers for this round: the tier's pool shuffled from the match seed and round (the same for
     * everyone), with the abilities this player already owns skipped, cut to the tier's offer count.
     */
    public List<Integer> abilityOffersForPlayer(MatchSession session, UUID recipientUserId) {
        int tier = tierForRound(session.roundNumber());
        List<Integer> pool = new ArrayList<>(TIER_ABILITIES.getOrDefault(tier, List.of()));
        long seed = session.simulationSeed() ^ (0x9E3779B97F4A7C15L * session.roundNumber());
        Collections.shuffle(pool, new Random(seed));
        Set<String> owned = ownedCodes(session, recipientUserId);
        List<Integer> offers = new ArrayList<>();
        int offerCount = TIER_OFFER_COUNTS.getOrDefault(tier, 0);
        for (Integer abilityId : pool) {
            if (offers.size() >= offerCount) break;
            String code = AbilityCatalog.codeForId(abilityId);
            if (code != null && !owned.contains(code)) offers.add(abilityId);
        }
        return List.copyOf(offers);
    }

    public MatchSession withDefaultAbilitySelections(MatchSession session) {
        MatchSession result = session;
        for (MatchPlayer player : session.players()) {
            if (player.loadoutSelected()) continue;
            String current = player.selectedLoadout() != null
                    && player.selectedLoadout().startsWith("custom:")
                    ? player.selectedLoadout()
                    : "custom:";
            result = result.withSelectedLoadout(
                    player.userId(),
                    completeRoundAbilityDraft(session, player, current),
                    true);
        }
        return result;
    }

    private Set<String> ownedCodes(MatchSession session, UUID userId) {
        return session.players().stream()
                .filter(player -> Objects.equals(player.userId(), userId))
                .findFirst()
                .map(player -> new LinkedHashSet<>(codesOf(player.selectedLoadout())))
                .map(codes -> (Set<String>) codes)
                .orElse(Set.of());
    }

    private static List<String> codesOf(String loadout) {
        if (loadout == null || !loadout.startsWith("custom:")) return List.of();
        String[] parts = loadout.split(":", -1);
        if (parts.length != 2) return List.of();
        List<String> codes = new ArrayList<>();
        for (char code : parts[1].toCharArray()) codes.add(String.valueOf(code));
        return codes;
    }

    private static boolean isWeaponCode(String code) {
        Integer abilityId = AbilityCatalog.idForCode(code);
        return abilityId != null && WEAPON_IDS.contains(abilityId);
    }

    /** What a submitted loadout adds to the player's previous one, and whether it is allowed. */
    private Draft draft(MatchSession session, MatchPlayer player, String nextLoadout) {
        List<String> previous = codesOf(player.selectedLoadout());
        List<String> next = codesOf(nextLoadout);
        Set<String> nextSet = new LinkedHashSet<>(next);
        Set<String> previousSet = new LinkedHashSet<>(previous);
        List<String> added = next.stream().filter(code -> !previousSet.contains(code)).toList();
        boolean valid = nextSet.size() == next.size()
                && nextSet.containsAll(previousSet)
                && next.size() <= MAX_EQUIPPED_ABILITIES
                && next.stream().allMatch(code -> AbilityCatalog.idForCode(code) != null);
        if (valid) {
            Set<String> offered = new LinkedHashSet<>();
            abilityOffersForPlayer(session, player.userId())
                    .forEach(offer -> offered.add(AbilityCatalog.codeForId(offer)));
            long weapons = added.stream().filter(MatchLoadoutService::isWeaponCode).count();
            boolean abilitiesOffered = added.stream()
                    .filter(code -> !isWeaponCode(code))
                    .allMatch(offered::contains);
            // The weapon is picked once, in round 1, and only from the weapon list.
            boolean weaponAllowed = session.roundNumber() <= 1 ? weapons <= 1 : weapons == 0;
            valid = abilitiesOffered && weaponAllowed;
        }
        return new Draft(previous, added, valid);
    }

    private record Draft(List<String> previousCodes, List<String> addedCodes, boolean valid) {}
}
