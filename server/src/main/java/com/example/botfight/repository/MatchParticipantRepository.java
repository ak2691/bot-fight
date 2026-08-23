package com.example.botfight.repository;

import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
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

    @Query(value = """
            select distinct
                gameMatch.id as matchId,
                opponentUser.username as opponentUsername,
                mine.result as result,
                gameMatch.completedAt as completedAt,
                gameMatch.completionReason as completionReason
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

    Optional<MatchParticipant> findByMatchIdAndUserId(UUID matchId, UUID userId);

    interface RecentMatchProjection {
        UUID getMatchId();

        String getOpponentUsername();

        MatchResult getResult();

        Instant getCompletedAt();

        String getCompletionReason();
    }
}
