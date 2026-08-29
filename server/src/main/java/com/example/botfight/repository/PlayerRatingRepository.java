package com.example.botfight.repository;

import com.example.botfight.domain.MatchMode;
import com.example.botfight.domain.PlayerRating;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlayerRatingRepository extends JpaRepository<PlayerRating, UUID> {

    Optional<PlayerRating> findByUserIdAndMode(UUID userId, MatchMode mode);

    @Query("""
            select rating
            from PlayerRating rating
            where rating.user.id in :userIds
              and rating.mode = :mode
            """)
    List<PlayerRating> findByUserIdsAndMode(
            @Param("userIds") Collection<UUID> userIds,
            @Param("mode") MatchMode mode);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select rating
            from PlayerRating rating
            where rating.user.id = :userId
              and rating.mode = :mode
            """)
    Optional<PlayerRating> findByUserIdAndModeForUpdate(
            @Param("userId") UUID userId,
            @Param("mode") MatchMode mode);
}
