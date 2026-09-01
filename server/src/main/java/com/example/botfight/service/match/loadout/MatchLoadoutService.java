package com.example.botfight.service.match.loadout;

import com.example.botfight.domain.BotSubmission;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Validates and deterministically completes the loadout draft for each round. */
public final class MatchLoadoutService {
    private static final int MAX_EQUIPPED_ABILITIES = 6;
    private static final Map<Integer, Integer> ROUND_OFFER_COUNTS = Map.of(1, 6, 2, 4, 3, 3);
    private static final Map<Integer, Integer> ROUND_PICK_COUNTS = Map.of(1, 3, 2, 2, 3, 1);
    private static final Map<Integer, List<Integer>> ROUND_ABILITIES = Map.of(
            1, List.of(1, 3, 4, 5, 7, 9, 10, 11, 12, 26, 28, 29),
            2, List.of(6, 8, 13, 14, 15, 16, 17, 18, 25, 30, 31, 32),
            3, List.of(21, 22, 23, 24, 27, 33));
    private final JsonMapper jsonMapper;

    public MatchLoadoutService(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public String normalize(String selectedLoadout) {
        if (selectedLoadout != null
                && selectedLoadout.matches("custom:[A-Za-z0-9]{0,6}")) {
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
                        ? CompactAbilityCode.codeForId(ability.intValue())
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
            Integer abilityId = CompactAbilityCode.idForCode(
                    String.valueOf(parts[1].charAt(index)));
            if (abilityId != null) abilityArray.add(abilityId);
        }
        return loadout;
    }

    public void validateRoundAbilityDraft(
            MatchSession session,
            MatchPlayer player,
            String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return;
        String nextCodes = nextLoadout.split(":", -1)[1];
        String previousLoadout = player.selectedLoadout();
        String previousCodes = previousLoadout != null && previousLoadout.startsWith("custom:")
                ? previousLoadout.split(":", -1)[1]
                : "";
        Set<Integer> previous = previousCodes.chars().boxed().collect(Collectors.toSet());
        Set<Integer> next = nextCodes.chars().boxed().collect(Collectors.toSet());
        Set<Integer> offered = offeredCodes(session, player.userId());
        Set<Integer> drafted = new HashSet<>(next);
        drafted.removeAll(previous);
        int requiredPicks = ROUND_PICK_COUNTS.getOrDefault(session.roundNumber(), 0);
        if (!next.containsAll(previous)
                || drafted.size() != requiredPicks
                || !offered.containsAll(drafted)
                || next.size() > MAX_EQUIPPED_ABILITIES) {
            throw new AuthException(
                    "bot loadout must retain prior abilities and choose exactly "
                            + requiredPicks + " abilities from this round's offers");
        }
    }

    public String completeRoundAbilityDraft(
            MatchSession session,
            MatchPlayer player,
            String nextLoadout) {
        if (nextLoadout == null || !nextLoadout.startsWith("custom:")) return nextLoadout;
        String[] parts = nextLoadout.split(":", -1);
        String nextCodes = parts[1];
        String previousLoadout = player.selectedLoadout();
        String previousCodes = previousLoadout != null && previousLoadout.startsWith("custom:")
                ? previousLoadout.split(":", -1)[1]
                : "";
        Set<Integer> previous = previousCodes.chars().boxed().collect(Collectors.toSet());
        Set<Integer> next = nextCodes.chars().boxed().collect(Collectors.toSet());
        Set<Integer> offered = offeredCodes(session, player.userId());
        Set<Integer> drafted = new HashSet<>(next);
        drafted.removeAll(previous);
        int requiredPicks = ROUND_PICK_COUNTS.getOrDefault(session.roundNumber(), 0);
        if (next.size() != nextCodes.length()
                || !next.containsAll(previous)
                || drafted.size() > requiredPicks
                || !offered.containsAll(drafted)
                || next.size() > MAX_EQUIPPED_ABILITIES) {
            throw new AuthException(
                    "bot loadout must retain prior abilities and choose up to "
                            + requiredPicks + " abilities from this round's offers");
        }

        int missingPicks = requiredPicks - drafted.size();
        List<Integer> additions = automaticAbilityPicks(session, player, drafted, missingPicks);
        Set<Integer> included = previousCodes.chars().boxed().collect(Collectors.toSet());
        StringBuilder ordered = new StringBuilder(previousCodes);
        for (char code : nextCodes.toCharArray()) {
            if (included.add((int) code)) ordered.append(code);
        }
        for (Integer ability : additions) {
            String code = CompactAbilityCode.codeForId(ability);
            if (code != null && included.add((int) code.charAt(0))) ordered.append(code);
        }
        return "custom:" + ordered;
    }

    public List<Integer> abilityOffers(MatchSession session) {
        UUID recipientUserId = session.players().isEmpty() ? null : session.players().get(0).userId();
        return abilityOffersForPlayer(session, recipientUserId);
    }

    /** Returns the common round offer plus this player's preselected guarantee, if any. */
    public List<Integer> abilityOffersForPlayer(MatchSession session, UUID recipientUserId) {
        List<Integer> offers = commonAbilityOffers(session, recipientUserId);
        Integer guarantee = session.guaranteedAbilitiesFor(recipientUserId)
                .get(session.roundNumber());
        if (guarantee != null && !offers.contains(guarantee)) {
            offers.add(guarantee);
        }
        return List.copyOf(offers);
    }

    /**
     * Normalizes the three queue slots into round-numbered guarantees. Empty
     * slots intentionally remain absent so the normal random offer pool is
     * used for that round.
     */
    public static Map<Integer, Integer> normalizeAbilityGuarantees(List<Integer> requestedAbilityIds) {
        List<Integer> requested = requestedAbilityIds == null ? List.of() : requestedAbilityIds;
        if (requested.size() > ROUND_ABILITIES.size()) {
            throw new AuthException("choose at most one guaranteed ability for each round");
        }

        Map<Integer, Integer> guarantees = new java.util.LinkedHashMap<>();
        for (int round = 1; round <= requested.size(); round++) {
            Integer requestedId = requested.get(round - 1);
            if (requestedId != null && !ROUND_ABILITIES.getOrDefault(round, List.of()).contains(requestedId)) {
                throw new AuthException("guaranteed ability must belong to its round");
            }
            if (requestedId != null) guarantees.put(round, requestedId);
        }
        return Map.copyOf(guarantees);
    }

    private List<Integer> commonAbilityOffers(MatchSession session, UUID recipientUserId) {
        List<Integer> offers = new ArrayList<>(
                ROUND_ABILITIES.getOrDefault(session.roundNumber(), List.of()));
        Set<Integer> guaranteedIds = session.guaranteedAbilitiesByUserId().values().stream()
                .flatMap(abilities -> abilities.values().stream())
                .collect(Collectors.toSet());
        offers.removeIf(guaranteedIds::contains);
        long seed = session.simulationSeed()
                ^ (0x9E3779B97F4A7C15L * session.roundNumber());
        Collections.shuffle(offers, new Random(seed));
        boolean hasGuarantee = session.guaranteedAbilitiesFor(recipientUserId)
                .containsKey(session.roundNumber());
        int randomOfferCount = ROUND_OFFER_COUNTS.getOrDefault(session.roundNumber(), 0)
                - (hasGuarantee ? 1 : 0);
        return new ArrayList<>(offers.subList(
                0,
                Math.min(Math.max(0, randomOfferCount), offers.size())));
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

    private Set<Integer> offeredCodes(MatchSession session, UUID recipientUserId) {
        return abilityOffersForPlayer(session, recipientUserId).stream()
                .map(CompactAbilityCode::codeForId)
                .filter(java.util.Objects::nonNull)
                .map(code -> (int) code.charAt(0))
                .collect(Collectors.toSet());
    }

    private List<Integer> automaticAbilityPicks(
            MatchSession session,
            MatchPlayer player,
            Set<Integer> excludedCodes,
            int pickCount) {
        List<Integer> picks = new ArrayList<>(abilityOffersForPlayer(session, player.userId()));
        picks.removeIf(ability -> {
            String code = CompactAbilityCode.codeForId(ability);
            return code == null || excludedCodes.contains((int) code.charAt(0));
        });
        long seed = session.simulationSeed()
                ^ player.userId().getMostSignificantBits()
                ^ player.userId().getLeastSignificantBits()
                ^ (0xD1B54A32D192ED03L * session.roundNumber());
        Collections.shuffle(picks, new Random(seed));
        return picks.subList(0, Math.min(pickCount, picks.size()));
    }

}
