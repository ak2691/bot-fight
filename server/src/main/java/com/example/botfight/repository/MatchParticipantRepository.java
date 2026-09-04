package com.example.botfight.repository;

import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchResult;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MatchParticipantRepository
        extends JpaRepository<MatchParticipant, UUID>, JpaSpecificationExecutor<MatchParticipant> {

    List<MatchParticipant> findByUserIdOrderByCreatedAtDesc(UUID userId);

    long countByUserIdAndResultAndMatchResultVisibleAtLessThanEqual(
            UUID userId, MatchResult result, Instant visibleAt);

    long countByUserIdAndResultInAndMatchResultVisibleAtLessThanEqual(
            UUID userId, List<MatchResult> results, Instant visibleAt);

    @Query("""
            select count(participant)
            from MatchParticipant participant
            join participant.match gameMatch
            where participant.user.id = :userId
              and gameMatch.mode = :mode
              and participant.result = :result
              and gameMatch.resultVisibleAt is not null
              and gameMatch.resultVisibleAt <= :visibleAt
            """)
    long countByUserIdAndModeAndResultAndMatchResultVisibleAtLessThanEqual(
            @Param("userId") UUID userId,
            @Param("mode") MatchMode mode,
            @Param("result") MatchResult result,
            @Param("visibleAt") Instant visibleAt);

    @Query("""
            select count(participant)
            from MatchParticipant participant
            join participant.match gameMatch
            where participant.user.id = :userId
              and gameMatch.mode = :mode
              and participant.result in (:results)
              and gameMatch.resultVisibleAt is not null
              and gameMatch.resultVisibleAt <= :visibleAt
            """)
    long countByUserIdAndModeAndResultInAndMatchResultVisibleAtLessThanEqual(
            @Param("userId") UUID userId,
            @Param("mode") MatchMode mode,
            @Param("results") List<MatchResult> results,
            @Param("visibleAt") Instant visibleAt);

    @Query(value = """
            select distinct
                gameMatch.id as matchId,
                mine.result as result,
                gameMatch.completedAt as completedAt,
                gameMatch.completionReason as completionReason,
                gameMatch.mode as mode,
                mine.teamNumber as teamNumber
            from MatchParticipant mine
            join mine.match gameMatch
            join MatchParticipant opponent
                on opponent.match.id = gameMatch.id
                and opponent.user.id <> :userId
            join opponent.user opponentUser
            where mine.user.id = :userId
              and mine.result is not null
              and gameMatch.resultVisibleAt is not null
              and gameMatch.resultVisibleAt <= :visibleAt
              and (:opponentQuery = ''
                   or locate(lower(:opponentQuery), lower(opponentUser.username)) > 0)
              and (cast(:fromInclusive as timestamp) is null
                   or gameMatch.completedAt >= :fromInclusive)
              and (cast(:toExclusive as timestamp) is null
                   or gameMatch.completedAt < :toExclusive)
            order by gameMatch.completedAt desc, gameMatch.id desc
            """,
            countQuery = """
            select count(distinct mine.id)
            from MatchParticipant mine
            join mine.match gameMatch
            join MatchParticipant opponent
                on opponent.match.id = gameMatch.id
                and opponent.user.id <> :userId
            join opponent.user opponentUser
            where mine.user.id = :userId
              and mine.result is not null
              and gameMatch.resultVisibleAt is not null
              and gameMatch.resultVisibleAt <= :visibleAt
              and (:opponentQuery = ''
                   or locate(lower(:opponentQuery), lower(opponentUser.username)) > 0)
              and (cast(:fromInclusive as timestamp) is null
                   or gameMatch.completedAt >= :fromInclusive)
              and (cast(:toExclusive as timestamp) is null
                   or gameMatch.completedAt < :toExclusive)
            """)
    Page<RecentMatchProjection> findRecentMatches(
            @Param("userId") UUID userId,
            @Param("visibleAt") Instant visibleAt,
            @Param("opponentQuery") String opponentQuery,
            @Param("fromInclusive") Instant fromInclusive,
            @Param("toExclusive") Instant toExclusive,
            Pageable pageable);

    List<MatchParticipant> findByMatchId(UUID matchId);

    List<MatchParticipant> findByMatchIdIn(List<UUID> matchIds);

    Optional<MatchParticipant> findByMatchIdAndUserId(UUID matchId, UUID userId);

    @Query("""
            select participant.user.id as userId,
                   participant.ratingBefore as ratingBefore,
                   participant.ratingAfter as ratingAfter,
                   gameMatch.resultVisibleAt as resultVisibleAt
            from MatchParticipant participant
            join participant.match gameMatch
            where participant.user.id in :userIds
              and gameMatch.mode = :mode
              and participant.ratingBefore is not null
              and participant.ratingAfter is not null
            order by gameMatch.completedAt desc, gameMatch.id desc
            """)
    List<RatingSnapshotProjection> findRatingSnapshotsByUserIdsAndMode(
            @Param("userIds") List<UUID> userIds,
            @Param("mode") MatchMode mode);

    interface RecentMatchProjection {
        UUID getMatchId();

        MatchResult getResult();

        Instant getCompletedAt();

        String getCompletionReason();

        String getMode();

        short getTeamNumber();
    }

    interface RatingSnapshotProjection {
        UUID getUserId();

        Integer getRatingBefore();

        Integer getRatingAfter();

        Instant getResultVisibleAt();
    }
}
