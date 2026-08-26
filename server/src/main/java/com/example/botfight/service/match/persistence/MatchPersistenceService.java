package com.example.botfight.service.match.persistence;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.MatchStatus;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.BotSubmissionStatus;
import com.example.botfight.domain.MatchRoundBotCode;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.repository.MatchRoundBotCodeRepository;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.cache.DatabaseLookupCache;
import java.time.Clock;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MatchPersistenceService {

    private static final String COMPLETION_REASON_SIMULATION = "SIMULATION";
    public static final String COMPLETION_REASON_SERVER_RESTART = "SERVER_RESTART";
    private static final String TIMEOUT_CLIENT_BUILD_VERSION = "server-building-timeout-v1";
    private static final String BRAIN_SCHEMA_VERSION = "bot-logic-tree-v1";
    private final MatchRepository matchRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final ProfileRepository profileRepository;
    private final UserRepository userRepository;
    private final MatchRoundBotCodeRepository matchRoundBotCodeRepository;
    private final Clock clock;
    private final JsonMapper jsonMapper;
    private final DatabaseLookupCache databaseLookupCache;

    public MatchPersistenceService(
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            ProfileRepository profileRepository,
            UserRepository userRepository,
            Clock clock,
            JsonMapper jsonMapper) {
        this(
                matchRepository,
                matchParticipantRepository,
                profileRepository,
                userRepository,
                clock,
                jsonMapper,
                null,
                new DatabaseLookupCache());
    }

    public MatchPersistenceService(
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            ProfileRepository profileRepository,
            UserRepository userRepository,
            Clock clock,
            JsonMapper jsonMapper,
            MatchRoundBotCodeRepository matchRoundBotCodeRepository) {
        this(
                matchRepository,
                matchParticipantRepository,
                profileRepository,
                userRepository,
                clock,
                jsonMapper,
                matchRoundBotCodeRepository,
                new DatabaseLookupCache());
    }

    @Autowired
    public MatchPersistenceService(
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            ProfileRepository profileRepository,
            UserRepository userRepository,
            Clock clock,
            JsonMapper jsonMapper,
            MatchRoundBotCodeRepository matchRoundBotCodeRepository,
            DatabaseLookupCache databaseLookupCache) {
        this.matchRepository = matchRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.profileRepository = profileRepository;
        this.userRepository = userRepository;
        this.clock = clock;
        this.jsonMapper = jsonMapper;
        this.matchRoundBotCodeRepository = matchRoundBotCodeRepository;
        this.databaseLookupCache = databaseLookupCache;
    }

    public Match createMatch() {
        Match match = new Match();
        match.setStatus(MatchStatus.RUNNING);
        match.setRulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION);
        match.setSimulationSeed(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE));
        match.setStartedAt(Instant.now(clock));
        return matchRepository.save(match);
    }

    /**
     * A match is persisted as RUNNING before its in-memory session is made
     * visible. A process restart loses those sessions, so any RUNNING row
     * found during the next startup represents an interrupted match.
     */
    @Transactional
    public int cancelMatchesInterruptedByServerRestart() {
        List<Match> runningMatches = matchRepository
                .findByStatusOrderByCreatedAtAsc(MatchStatus.RUNNING);
        if (runningMatches == null || runningMatches.isEmpty()) {
            return 0;
        }

        Instant completedAt = Instant.now(clock);
        List<Match> cancelledMatches = runningMatches.stream()
                .filter(match -> match.getStatus() == MatchStatus.RUNNING)
                .peek(match -> {
                    match.setStatus(MatchStatus.CANCELLED);
                    match.setCompletionReason(COMPLETION_REASON_SERVER_RESTART);
                    match.setCompletedAt(completedAt);
                    match.setWinnerUser(null);
                })
                .toList();
        if (cancelledMatches.isEmpty()) {
            return 0;
        }

        matchRepository.saveAll(cancelledMatches);
        return cancelledMatches.size();
    }

    public void createParticipants(Match match, MatchSession session) {
        List<MatchParticipant> participants = session.players().stream()
                .map(player -> {
                    MatchParticipant participant = new MatchParticipant();
                    participant.setMatch(match);
                    participant.setUser(userRepository.getReferenceById(player.userId()));
                    participant.setSlot((short) player.slot());
                    participant.setSelectedLoadout(player.selectedLoadout());
                    return participant;
                })
                .toList();
        matchParticipantRepository.saveAll(participants);
    }

    public boolean isTerminalMatch(UUID matchId) {
        return matchRepository.findById(matchId)
                .map(match -> match.getStatus() != MatchStatus.PENDING
                        && match.getStatus() != MatchStatus.RUNNING)
                .orElse(false);
    }

    public void updateParticipantSelectedLoadout(UUID matchId, MatchPlayer player) {
        matchParticipantRepository.findByMatchIdAndUserId(matchId, player.userId())
                .ifPresent(participant -> {
                    participant.setSelectedLoadout(player.selectedLoadout());
                    matchParticipantRepository.save(participant);
                });
    }

    /** Builds the server-owned timeout brain without touching submission rows. */
    public BotSubmission createBuildingTimeoutSubmission(
            MatchSession session,
            MatchPlayer player,
            BotSubmission previous) {
        String fallbackKey = "server-timeout:" + session.matchId()
                + ":" + session.roundNumber() + ":" + player.userId();
        String brainPayload = resolvedBrainPayload(previous, player.selectedLoadout());
        BotSubmission fallback = new BotSubmission();
        AppUser user = new AppUser();
        user.setId(player.userId());
        fallback.setId(UUID.randomUUID());
        fallback.setUser(user);
        fallback.setMatchId(session.matchId());
        fallback.setRequestFingerprint(sha256Hex(fallbackKey + ":" + brainPayload));
        fallback.setSelectedLoadout(player.selectedLoadout());
        fallback.setClientBuildVersion(TIMEOUT_CLIENT_BUILD_VERSION);
        fallback.setBrainSchemaVersion(BRAIN_SCHEMA_VERSION);
        fallback.setBrainPayload(brainPayload);
        fallback.setStatus(BotSubmissionStatus.VALIDATED);
        return fallback;
    }

    private String resolvedBrainPayload(BotSubmission previous, String selectedLoadout) {
        ObjectNode brain = previous == null
                ? emptyBrain()
                : readBrain(previous.getBrainPayload());
        ObjectNode currentLoadout = currentLoadout(selectedLoadout);
        if (currentLoadout == null) {
            brain.remove("loadout");
        } else {
            brain.set("loadout", currentLoadout);
        }
        try {
            return jsonMapper.writeValueAsString(brain);
        } catch (Exception exception) {
            throw new AuthException("server timeout brain could not be serialized");
        }
    }

    private ObjectNode readBrain(String payload) {
        try {
            JsonNode parsed = jsonMapper.readTree(payload == null ? "{}" : payload);
            if (parsed instanceof ObjectNode object) return object;
            throw new AuthException("previous bot brain must be a JSON object");
        } catch (AuthException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new AuthException("previous bot brain could not be read");
        }
    }

    private ObjectNode emptyBrain() {
        ObjectNode brain = jsonMapper.createObjectNode();
        brain.put("version", BRAIN_SCHEMA_VERSION);
        brain.putArray("roots");
        brain.putArray("customVariables");
        return brain;
    }

    private ObjectNode currentLoadout(String selectedLoadout) {
        if (selectedLoadout == null || !selectedLoadout.startsWith("custom:")) return null;
        String[] parts = selectedLoadout.split(":", -1);
        if (parts.length != 2) return null;

        ObjectNode loadout = jsonMapper.createObjectNode();
        ArrayNode abilities = loadout.putArray("abilities");
        for (int index = 0; index < parts[1].length(); index++) {
            Integer ability = CompactAbilityCode.idForCode(String.valueOf(parts[1].charAt(index)));
            if (ability != null) abilities.add(ability);
        }
        return loadout;
    }

    private String sha256Hex(String value) {
        try {
            return java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    /**
     * Stores the in-memory authoritative submissions only after the match has
     * reached a terminal, valid outcome. The unique key mirrors the runtime
     * idempotency key and makes future round-by-round history reads safe.
     */
    @Transactional
    public void persistMatchRoundBotCodes(
            UUID matchId,
            Map<Integer, Map<UUID, BotSubmission>> submissionsByRound) {
        if (matchRoundBotCodeRepository == null
                || matchId == null
                || submissionsByRound == null
                || submissionsByRound.isEmpty()) {
            return;
        }

        Match match = matchRepository.getReferenceById(matchId);
        Instant persistedAt = Instant.now(clock);
        List<MatchRoundBotCode> historyRows = new java.util.ArrayList<>();
        submissionsByRound.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(round -> round.getValue().entrySet().stream()
                        .sorted(Map.Entry.comparingByKey())
                        .forEach(entry -> {
                            BotSubmission submission = entry.getValue();
                            MatchRoundBotCode row = new MatchRoundBotCode();
                            row.setMatch(match);
                            row.setUser(userRepository.getReferenceById(entry.getKey()));
                            row.setRoundNumber(round.getKey());
                            row.setPhase("BUILDING");
                            row.setSubmissionFingerprint(submission.getRequestFingerprint());
                            row.setSelectedLoadout(submission.getSelectedLoadout());
                            row.setBrainSchemaVersion(submission.getBrainSchemaVersion());
                            row.setClientBuildVersion(submission.getClientBuildVersion());
                            row.setBrainPayload(submission.getBrainPayload() == null
                                    ? "{}"
                                    : submission.getBrainPayload());
                            row.setSubmittedAt(submission.getSubmittedAt() == null
                                    ? persistedAt
                                    : submission.getSubmittedAt());
                            historyRows.add(row);
                        }));
        if (!historyRows.isEmpty()) {
            matchRoundBotCodeRepository.saveAll(historyRows);
        }
    }

    public void completeMatch(UUID matchId, MatchPlaybackDTO playback) {
        completeMatch(
                matchId,
                playback.winnerUserId(),
                "FAILED".equals(playback.status()) || "ERROR".equals(playback.result()));
    }

    public void completeMatch(UUID matchId, MatchReplayDTO playback) {
        completeMatch(
                matchId,
                playback.winnerUserId(),
                "ERROR".equals(playback.result()));
    }

    @Transactional
    public void setResultVisibleAt(UUID matchId, Instant resultVisibleAt) {
        if (matchId == null || resultVisibleAt == null) return;
        matchRepository.findById(matchId).ifPresent(match -> {
            match.setResultVisibleAt(resultVisibleAt);
            matchParticipantRepository.findByMatchId(matchId).stream()
                    .map(participant -> participant.getUser().getId())
                    .distinct()
                    .forEach(userId -> {
                        databaseLookupCache.logDatabaseWrite(
                                "profile-summary",
                                userId,
                                "match-result-visible");
                        databaseLookupCache.invalidateAfterMatchWrite(
                                userId,
                                "match-result-visible");
                    });
        });
    }

    private void completeMatch(UUID matchId, UUID winnerUserId, boolean failed) {
        Match match = runningMatch(matchId);
        if (match == null) return;
        List<MatchParticipant> participants =
                matchParticipantRepository.findByMatchId(matchId);

        match.setStatus(failed ? MatchStatus.FAILED : MatchStatus.COMPLETED);
        match.setCompletionReason(COMPLETION_REASON_SIMULATION);
        Instant completedAt = Instant.now(clock);
        match.setCompletedAt(completedAt);

        if (winnerUserId != null) {
            match.setWinnerUser(userRepository.getReferenceById(winnerUserId));
        }
        for (MatchParticipant participant : participants) {
            if (winnerUserId == null) {
                participant.setResult(MatchResult.DRAW);
            } else if (participant.getUser().getId().equals(winnerUserId)) {
                participant.setResult(MatchResult.WIN);
            } else {
                participant.setResult(MatchResult.LOSS);
            }
            incrementMatchesPlayed(participant.getUser());
        }
        saveResult(match, participants);
    }

    public void completeMatchByForfeit(
            UUID matchId,
            MatchPlayer forfeitingPlayer,
            MatchPlayer winner,
            String completionReason) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new AuthException("match was not found"));
        boolean alreadyCompletedBySimulation = match.getStatus() == MatchStatus.COMPLETED
                && COMPLETION_REASON_SIMULATION.equals(match.getCompletionReason());
        if (match.getStatus() != MatchStatus.RUNNING && !alreadyCompletedBySimulation) return;
        List<MatchParticipant> participants =
                matchParticipantRepository.findByMatchId(matchId);

        match.setStatus(MatchStatus.COMPLETED);
        match.setCompletionReason(completionReason);
        Instant completedAt = Instant.now(clock);
        match.setCompletedAt(completedAt);
        match.setResultVisibleAt(completedAt);
        match.setWinnerUser(userRepository.getReferenceById(winner.userId()));

        for (MatchParticipant participant : participants) {
            if (participant.getUser().getId().equals(forfeitingPlayer.userId())) {
                participant.setResult(MatchResult.FORFEIT);
            } else if (participant.getUser().getId().equals(winner.userId())) {
                participant.setResult(MatchResult.WIN);
            }
            if (!alreadyCompletedBySimulation) {
                incrementMatchesPlayed(participant.getUser());
            }
        }
        saveResult(match, participants);
    }

    public void completeMatchAsDraw(UUID matchId, String completionReason) {
        Match match = runningMatch(matchId);
        if (match == null) return;
        List<MatchParticipant> participants =
                matchParticipantRepository.findByMatchId(matchId);

        match.setStatus(MatchStatus.COMPLETED);
        match.setCompletionReason(completionReason);
        Instant completedAt = Instant.now(clock);
        match.setCompletedAt(completedAt);
        match.setResultVisibleAt(completedAt);
        match.setWinnerUser(null);

        for (MatchParticipant participant : participants) {
            participant.setResult(MatchResult.DRAW);
            incrementMatchesPlayed(participant.getUser());
        }
        saveResult(match, participants);
    }

    private Match runningMatch(UUID matchId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new AuthException("match was not found"));
        return match.getStatus() == MatchStatus.RUNNING ? match : null;
    }

    private void saveResult(
            Match match,
            List<MatchParticipant> participants) {
        matchRepository.save(match);
        matchParticipantRepository.saveAll(participants);
    }

    private void incrementMatchesPlayed(AppUser user) {
        databaseLookupCache.logDatabaseWrite(
                "profile-summary",
                user.getId(),
                "match-result-profile-lookup");
        var profile = profileRepository.findByUserId(user.getId())
                .orElseGet(() -> {
                    var created = new com.example.botfight.domain.Profile();
                    created.setUser(userRepository.getReferenceById(user.getId()));
                    return created;
        });
        profile.setMatchesPlayed(profile.getMatchesPlayed() + 1);
        profileRepository.save(profile);
        databaseLookupCache.invalidateAfterMatchWrite(user.getId(), "match-result-written");
    }
}
