package com.example.botfight.repository;

import com.example.botfight.domain.block.UserBlock;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface UserBlockRepository extends JpaRepository<UserBlock, UUID> {

    boolean existsByBlockerIdAndBlockedId(UUID blockerId, UUID blockedId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query(value = """
            insert into user_blocks (blocker_user_id, blocked_user_id)
            values (:blockerId, :blockedId)
            on conflict (blocker_user_id, blocked_user_id) do nothing
            """, nativeQuery = true)
    int insertIfAbsent(
            @Param("blockerId") UUID blockerId,
            @Param("blockedId") UUID blockedId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    int deleteByBlockerIdAndBlockedId(UUID blockerId, UUID blockedId);
}
