package com.example.botfight.service;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.MatchStatus;
import com.example.botfight.domain.ModelSubmission;
import com.example.botfight.domain.ModelSubmissionStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.ModelSubmissionRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.MatchService.MatchPlayer;
import com.example.botfight.service.MatchService.MatchSession;
import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;

@Service
public class MatchPersistenceService {

    private static final String COMPLETION_REASON_SIMULATION = "SIMULATION";

    private final MatchRepository matchRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final ModelSubmissionRepository modelSubmissionRepository;
    private final ProfileRepository profileRepository;
    private final UserRepository userRepository;
    private final Clock clock;

    public MatchPersistenceService(
            MatchRepository matchRepository,
            MatchParticipantRepository matchParticipantRepository,
            ModelSubmissionRepository modelSubmissionRepository,
            ProfileRepository profileRepository,
            UserRepository userRepository,
            Clock clock) {
        this.matchRepository = matchRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.modelSubmissionRepository = modelSubmissionRepository;
        this.profileRepository = profileRepository;
        this.userRepository = userRepository;
        this.clock = clock;
    }

    public Match createMatch() {
        Match match = new Match();
        match.setStatus(MatchStatus.RUNNING);
        match.setRulesetVersion(MatchSimulationService.DUEL_RULESET_VERSION);
        match.setSimulationSeed(ThreadLocalRandom.current().nextLong(1, Long.MAX_VALUE));
        match.setStartedAt(Instant.now(clock));
        return matchRepository.save(match);
    }

    public void createParticipants(Match match, MatchSession session) {
        List<MatchParticipant> participants = session.players().stream()
                .map(player -> {
                    MatchParticipant participant = new MatchParticipant();
                    participant.setMatch(match);
                    participant.setUser(userRepository.getReferenceById(player.userId()));
                    participant.setSlot((short) player.slot());
                    participant.setSelectedClass(player.selectedClass());
                    return participant;
                })
                .toList();
        matchParticipantRepository.saveAll(participants);
    }

    public void updateParticipantSelectedClass(UUID matchId, MatchPlayer player) {
        matchParticipantRepository.findByMatchIdAndUserId(matchId, player.userId())
                .ifPresent(participant -> {
                    participant.setSelectedClass(player.selectedClass());
                    matchParticipantRepository.save(participant);
                });
    }

    public ModelSubmission requireValidatedSubmission(
            UUID userId,
            UUID modelSubmissionId,
            UUID matchId) {
        if (modelSubmissionId == null) {
            throw new AuthException("modelSubmissionId is required before finishing the match");
        }

        ModelSubmission submission = modelSubmissionRepository
                .findByIdAndUserId(modelSubmissionId, userId)
                .orElseThrow(() -> new AuthException(
                        "model submission was not found for this player"));
        if (submission.getStatus() != ModelSubmissionStatus.VALIDATED) {
            throw new AuthException(
                    "model submission must be validated before finishing the match");
        }
        if (submission.getMatchId() == null
                || !submission.getMatchId().equals(matchId)) {
            throw new AuthException("model submission is not assigned to this match");
        }
        return submission;
    }

    public void attachSubmission(
            UUID matchId,
            UUID userId,
            ModelSubmission submission) {
        MatchParticipant participant = matchParticipantRepository
                .findByMatchIdAndUserId(matchId, userId)
                .orElseThrow(() -> new AuthException(
                        "match participant was not found"));
        participant.setModelSubmission(submission);
        participant.setSelectedClass(submission.getSelectedClass());
        matchParticipantRepository.save(participant);
    }

    public Map<UUID, ModelSubmission> loadFinishedSubmissions(
            MatchSession session) {
        Map<UUID, ModelSubmission> submissions = new HashMap<>();
        for (MatchPlayer player : session.players()) {
            if (player.modelSubmissionId() == null) {
                continue;
            }
            modelSubmissionRepository
                    .findByIdAndUserId(player.modelSubmissionId(), player.userId())
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
        Match match = runningMatch(matchId);
        if (match == null) return;
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
            incrementMatchesPlayed(participant.getUser());
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
