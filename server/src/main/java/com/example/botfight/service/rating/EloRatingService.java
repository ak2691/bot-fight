package com.example.botfight.service.rating;

import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchResult;
import com.example.botfight.domain.rating.PlayerRating;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.PlayerRatingRepository;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authoritative per-mode Elo ratings for queue matches.
 *
 * <p>Glicko-2 is intentionally not used yet: the product currently exposes a
 * single skill number and has no rating-deviation or volatility contract. Elo
 * gives deterministic, symmetric updates while leaving room to add those
 * dimensions later without changing match results.</p>
 */
@Service
public class EloRatingService {

    public static final int DEFAULT_RATING = 1000;
    public static final int PROVISIONAL_MATCHES = 10;
    public static final int PROVISIONAL_K_FACTOR = 40;
    public static final int ESTABLISHED_K_FACTOR = 24;
    public static final int ELO_SCALE = 400;

    private final PlayerRatingRepository playerRatingRepository;
    private final MatchParticipantRepository matchParticipantRepository;

    public EloRatingService(PlayerRatingRepository playerRatingRepository) {
        this(playerRatingRepository, null);
    }

    @Autowired
    public EloRatingService(
            PlayerRatingRepository playerRatingRepository,
            MatchParticipantRepository matchParticipantRepository) {
        this.playerRatingRepository = playerRatingRepository;
        this.matchParticipantRepository = matchParticipantRepository;
    }

    /** Returns a stable snapshot for matchmaking or a profile read model. */
    public Map<UUID, Integer> ratingsFor(Collection<UUID> userIds, MatchMode mode) {
        List<UUID> uniqueUserIds = userIds == null
                ? List.of()
                : userIds.stream()
                        .filter(java.util.Objects::nonNull)
                        .distinct()
                        .toList();
        if (uniqueUserIds.isEmpty()) return Map.of();

        Map<UUID, Integer> storedRatings = new HashMap<>();
        if (isRatedMode(mode)) {
            List<PlayerRating> rows = playerRatingRepository.findByUserIdsAndMode(uniqueUserIds, mode);
            if (rows != null) {
                rows.stream()
                        .filter(row -> row.getUser() != null && row.getUser().getId() != null)
                        .forEach(row -> storedRatings.put(row.getUser().getId(), row.getRating()));
            }
        }

        Map<UUID, Integer> visibleRatings = visibleRatings(uniqueUserIds, mode);
        return uniqueUserIds.stream().collect(Collectors.toMap(
                userId -> userId,
                userId -> visibleRatings.getOrDefault(
                        userId,
                        storedRatings.getOrDefault(userId, DEFAULT_RATING)),
                (left, right) -> left,
                LinkedHashMap::new));
    }

    /**
     * A terminal result is persisted before its replay is revealed. Keep reads
     * on the pre-match value until the server's result-visible boundary, while
     * still using the regular player-rating table as a fallback for historical
     * rows created before per-match rating snapshots existed.
     */
    private Map<UUID, Integer> visibleRatings(List<UUID> userIds, MatchMode mode) {
        if (matchParticipantRepository == null || !isRatedMode(mode)) return Map.of();

        List<MatchParticipantRepository.RatingSnapshotProjection> snapshots =
                matchParticipantRepository.findRatingSnapshotsByUserIdsAndMode(userIds, mode);
        if (snapshots == null || snapshots.isEmpty()) return Map.of();

        Map<UUID, Integer> latestVisible = new HashMap<>();
        Map<UUID, Integer> pendingBefore = new HashMap<>();
        Instant now = Instant.now();
        for (MatchParticipantRepository.RatingSnapshotProjection snapshot : snapshots) {
            if (snapshot == null
                    || snapshot.getUserId() == null
                    || snapshot.getRatingBefore() == null
                    || snapshot.getRatingAfter() == null) continue;
            java.time.Instant visibleAt = snapshot.getResultVisibleAt();
            if (visibleAt == null || visibleAt.isAfter(now)) {
                pendingBefore.putIfAbsent(snapshot.getUserId(), snapshot.getRatingBefore());
            } else {
                latestVisible.putIfAbsent(snapshot.getUserId(), snapshot.getRatingAfter());
            }
        }

        Map<UUID, Integer> resolved = new HashMap<>(latestVisible);
        pendingBefore.forEach(resolved::put);
        return resolved;
    }

    public int ratingFor(UUID userId, MatchMode mode) {
        return ratingsFor(List.of(userId), mode).getOrDefault(userId, DEFAULT_RATING);
    }

    /**
     * Applies one terminal, rated result. The caller must already have
     * assigned authoritative participant results; custom and failed matches
     * never enter this method.
     */
    @Transactional
    public void applyRatedResult(Match match, List<MatchParticipant> participants) {
        if (match == null || !isRatedMode(match.getMode()) || participants == null
                || participants.isEmpty()) {
            return;
        }

        Map<Short, List<MatchParticipant>> participantsByTeam = participants.stream()
                .filter(participant -> participant != null
                        && participant.getUser() != null
                        && participant.getUser().getId() != null
                        && participant.getTeamNumber() > 0)
                .collect(Collectors.groupingBy(
                        MatchParticipant::getTeamNumber,
                        LinkedHashMap::new,
                        Collectors.toList()));
        if (participantsByTeam.size() != 2) return;

        Map<UUID, MatchParticipant> participantByUser = participants.stream()
                .filter(participant -> participant != null
                        && participant.getUser() != null
                        && participant.getUser().getId() != null)
                .collect(Collectors.toMap(
                        participant -> participant.getUser().getId(),
                        participant -> participant,
                        (left, right) -> left,
                        LinkedHashMap::new));

        Map<UUID, PlayerRating> ratingsByUser = new LinkedHashMap<>();
        participantByUser.keySet().stream()
                .sorted(Comparator.comparing(UUID::toString))
                .forEach(userId -> ratingsByUser.put(
                        userId,
                        lockedOrNewRating(
                                participantByUser.get(userId).getUser(),
                                match.getMode())));

        Map<Short, Double> teamRatings = new HashMap<>();
        participantsByTeam.forEach((team, teamParticipants) -> teamRatings.put(
                team,
                teamParticipants.stream()
                        .mapToDouble(participant -> ratingsByUser
                                .get(participant.getUser().getId())
                                .getRating())
                        .average()
                        .orElse(DEFAULT_RATING)));

        List<Short> teams = participantsByTeam.keySet().stream().toList();
        double firstTeamRating = teamRatings.get(teams.getFirst());
        double secondTeamRating = teamRatings.get(teams.get(1));
        Map<Short, Double> expectedScores = Map.of(
                teams.getFirst(), expectedScore(firstTeamRating, secondTeamRating),
                teams.get(1), expectedScore(secondTeamRating, firstTeamRating));
        List<Short> winningTeams = participantsByTeam.entrySet().stream()
                .filter(entry -> entry.getValue().stream()
                        .anyMatch(participant -> participant.getResult() == MatchResult.WIN))
                .map(Map.Entry::getKey)
                .toList();
        if (winningTeams.size() > 1) return;
        Short winningTeam = winningTeams.isEmpty() ? null : winningTeams.getFirst();
        boolean draw = winningTeam == null;
        if (draw && participantsByTeam.values().stream()
                .flatMap(List::stream)
                .anyMatch(participant -> participant.getResult() != MatchResult.DRAW)) {
            return;
        }

        ratingsByUser.forEach((userId, rating) -> {
            MatchParticipant participant = participantByUser.get(userId);
            double score = draw
                    ? 0.5d
                    : participant.getTeamNumber() == winningTeam ? 1.0d : 0.0d;
            double expected = expectedScores.getOrDefault(
                    participant.getTeamNumber(), 0.5d);
            int before = rating.getRating();
            int kFactor = rating.getRatedMatches() < PROVISIONAL_MATCHES
                    ? PROVISIONAL_K_FACTOR
                    : ESTABLISHED_K_FACTOR;
            int after = Math.max(0, (int) Math.round(
                    before + kFactor * (score - expected)));
            participant.setRatingBefore(before);
            participant.setRatingAfter(after);
            rating.setRating(after);
            rating.setRatedMatches(rating.getRatedMatches() + 1);
        });

        playerRatingRepository.saveAll(ratingsByUser.values());
    }

    private PlayerRating lockedOrNewRating(AppUser user, MatchMode mode) {
        var stored = playerRatingRepository.findByUserIdAndModeForUpdate(user.getId(), mode);
        if (stored != null && stored.isPresent()) return stored.get();

        PlayerRating created = new PlayerRating();
        created.setUser(user);
        created.setMode(mode);
        created.setRating(DEFAULT_RATING);
        created.setRatedMatches(0);
        return created;
    }

    private static double expectedScore(double ownRating, double opponentRating) {
        return 1.0d / (1.0d + Math.pow(10.0d,
                (opponentRating - ownRating) / ELO_SCALE));
    }

    private static boolean isRatedMode(MatchMode mode) {
        return mode == MatchMode.ONES || mode == MatchMode.TWOS;
    }
}
