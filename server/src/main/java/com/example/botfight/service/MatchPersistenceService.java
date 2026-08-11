package com.example.botfight.service;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.MatchStatus;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.BotSubmissionStatus;
import com.example.botfight.domain.ValidationResult;
import com.example.botfight.domain.ValidationStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.BotSubmissionRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.repository.ValidationResultRepository;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import com.example.botfight.service.MatchService.MatchPlayer;
import com.example.botfight.service.MatchService.MatchSession;
import java.time.Clock;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
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
    private static final String VALIDATOR_VERSION = "bot-brain-submission-v1";
    private final MatchRepository matchRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final BotSubmissionRepository botSubmissionRepository;
    private final ProfileRepository profileRepository;
    private final UserRepository userRepository;
    private final ValidationResultRepository validationResultRepository;
    private final Clock clock;
    private final JsonMapper jsonMapper;

    public MatchPersistenceService(
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            BotSubmissionRepository botSubmissionRepository,
            ProfileRepository profileRepository,
            UserRepository userRepository,
            ValidationResultRepository validationResultRepository,
            Clock clock,
            JsonMapper jsonMapper) {
        this.matchRepository = matchRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.botSubmissionRepository = botSubmissionRepository;
        this.profileRepository = profileRepository;
        this.userRepository = userRepository;
        this.validationResultRepository = validationResultRepository;
        this.clock = clock;
        this.jsonMapper = jsonMapper;
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

    public BotSubmission requireValidatedSubmission(
            UUID userId,
            UUID botSubmissionId,
            UUID matchId) {
        if (botSubmissionId == null) {
            throw new AuthException("botSubmissionId is required before finishing the match");
        }

        BotSubmission submission = botSubmissionRepository
                .findByIdAndUserId(botSubmissionId, userId)
                .orElseThrow(() -> new AuthException(
                        "bot submission was not found for this player"));
        if (submission.getStatus() != BotSubmissionStatus.VALIDATED) {
            throw new AuthException(
                    "bot submission must be validated before finishing the match");
        }
        if (submission.getMatchId() == null
                || !submission.getMatchId().equals(matchId)) {
            throw new AuthException("bot submission is not assigned to this match");
        }
        return submission;
    }

    public void attachSubmission(
            UUID matchId,
            UUID userId,
            BotSubmission submission) {
        MatchParticipant participant = matchParticipantRepository
                .findByMatchIdAndUserId(matchId, userId)
                .orElseThrow(() -> new AuthException(
                        "match participant was not found"));
        participant.setBotSubmission(submission);
        participant.setSelectedLoadout(submission.getSelectedLoadout());
        matchParticipantRepository.save(participant);
    }

    /**
     * Resolves a player who missed the server-owned building deadline. Later
     * rounds inherit the prior accepted brain, while round one starts with a
     * canonical empty brain. The derived row keeps the current round's
     * selected loadout authoritative for simulation.
     */
    public BotSubmission resolveBuildingTimeoutSubmission(
            MatchSession session,
            MatchPlayer player) {
        BotSubmission previous = session.roundNumber() > 1
                ? matchParticipantRepository.findByMatchIdAndUserId(session.matchId(), player.userId())
                        .map(MatchParticipant::getBotSubmission)
                        .filter(submission -> submission.getStatus() == BotSubmissionStatus.VALIDATED)
                        .filter(submission -> session.matchId().equals(submission.getMatchId()))
                        .orElse(null)
                : null;

        String fallbackKey = "server-timeout:" + session.matchId()
                + ":" + session.roundNumber() + ":" + player.userId();
        BotSubmission existing = botSubmissionRepository
                .findByUserIdAndBuildingSessionIdAndRequestFingerprintIsNotNull(
                        player.userId(), fallbackKey)
                .orElse(null);
        if (existing != null && existing.getStatus() == BotSubmissionStatus.VALIDATED) {
            return existing;
        }

        String brainPayload = resolvedBrainPayload(previous, player.selectedLoadout());
        BotSubmission fallback = new BotSubmission();
        fallback.setUser(userRepository.getReferenceById(player.userId()));
        fallback.setMatchId(session.matchId());
        fallback.setBuildingSessionId(fallbackKey);
        fallback.setRequestFingerprint(sha256Hex(fallbackKey + ":" + brainPayload));
        fallback.setSelectedLoadout(player.selectedLoadout());
        fallback.setClientBuildVersion(TIMEOUT_CLIENT_BUILD_VERSION);
        fallback.setBrainSchemaVersion(BRAIN_SCHEMA_VERSION);
        fallback.setBrainPayload(brainPayload);
        fallback.setStatus(BotSubmissionStatus.VALIDATED);

        BotSubmission saved = botSubmissionRepository.save(fallback);
        ValidationResult validationResult = new ValidationResult();
        validationResult.setBotSubmission(saved);
        validationResult.setStatus(ValidationStatus.ACCEPTED);
        validationResult.setValidatorVersion(VALIDATOR_VERSION);
        validationResult.setDetails("{\"source\":\"SERVER_TESTING_TIMEOUT\",\"inherited\":"
                + (previous != null) + "}");
        validationResultRepository.save(validationResult);
        return saved;
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
            JsonNode normalized = LegacyAbilityPayloadMigration.normalize(parsed);
            if (normalized instanceof ObjectNode object) return object;
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
        if (parts.length != 3) return null;

        ObjectNode loadout = jsonMapper.createObjectNode();
        ArrayNode abilities = loadout.putArray("abilities");
        for (int index = 0; index < parts[1].length(); index++) {
            Integer ability = CompactAbilityCode.idForCode(String.valueOf(parts[1].charAt(index)));
            if (ability != null) abilities.add(ability);
        }
        String[] points = parts[2].split(",", -1);
        if (points.length != 4) return null;
        ObjectNode statPoints = loadout.putObject("statPoints");
        for (int index = 0; index < 4; index++) {
            try {
                statPoints.put(List.of("maxHp", "moveSpeed", "attackDamage", "attackSpeed").get(index),
                        Math.max(0, Integer.parseInt(points[index])));
            } catch (NumberFormatException exception) {
                return null;
            }
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

    public Map<UUID, BotSubmission> loadFinishedSubmissions(
            MatchSession session) {
        Map<UUID, BotSubmission> submissions = new HashMap<>();
        for (MatchPlayer player : session.players()) {
            if (player.botSubmissionId() == null) {
                continue;
            }
            botSubmissionRepository
                    .findByIdAndUserId(player.botSubmissionId(), player.userId())
                    .ifPresent(submission ->
                            submissions.put(player.userId(), submission));
        }
        return submissions;
    }

    public void completeMatch(UUID matchId, MatchPlaybackDTO playback) {
        Match match = runningMatch(matchId);
        if (match == null) return;
        List<MatchParticipant> participants =
                matchParticipantRepository.findByMatchId(matchId);

        match.setStatus("FAILED".equals(playback.status())
                || "ERROR".equals(playback.result())
                        ? MatchStatus.FAILED
                        : MatchStatus.COMPLETED);
        match.setCompletionReason(COMPLETION_REASON_SIMULATION);
        match.setCompletedAt(Instant.now(clock));

        UUID winnerUserId = playback.winnerUserId();
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
        match.setCompletedAt(Instant.now(clock));
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
        match.setCompletedAt(Instant.now(clock));
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
        var profile = profileRepository.findByUserId(user.getId())
                .orElseGet(() -> {
                    var created = new com.example.botfight.domain.Profile();
                    created.setUser(userRepository.getReferenceById(user.getId()));
                    return created;
                });
        profile.setMatchesPlayed(profile.getMatchesPlayed() + 1);
        profileRepository.save(profile);
    }
}
