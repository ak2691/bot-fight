package com.example.botfight.repository;

import com.example.botfight.domain.DuelInvite;
import com.example.botfight.domain.DuelInviteStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import jakarta.persistence.LockModeType;

public interface DuelInviteRepository extends JpaRepository<DuelInvite, UUID> {

    @Query("""
            select invite
            from DuelInvite invite
            where invite.status = :status
              and ((invite.inviter.id = :firstUserId and invite.invitee.id = :secondUserId)
                   or (invite.inviter.id = :secondUserId and invite.invitee.id = :firstUserId))
            order by invite.createdAt desc
            """)
    List<DuelInvite> findPendingBetweenUsers(
            @Param("firstUserId") UUID firstUserId,
            @Param("secondUserId") UUID secondUserId,
            @Param("status") DuelInviteStatus status);

    List<DuelInvite> findByInviteeIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
            UUID inviteeId,
            DuelInviteStatus status,
            Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select invite
            from DuelInvite invite
            where invite.id = :inviteId
              and invite.invitee.id = :inviteeId
            """)
    Optional<DuelInvite> findForInviteeForUpdate(
            @Param("inviteId") UUID inviteId,
            @Param("inviteeId") UUID inviteeId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
            update DuelInvite invite
               set invite.status = :expiredStatus,
                   invite.respondedAt = :now
             where invite.status = :pendingStatus
               and invite.expiresAt <= :now
            """)
    int expirePendingBefore(
            @Param("pendingStatus") DuelInviteStatus pendingStatus,
            @Param("expiredStatus") DuelInviteStatus expiredStatus,
            @Param("now") Instant now);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
            delete from DuelInvite invite
             where invite.status in :terminalStatuses
               and invite.expiresAt <= :cutoff
            """)
    int deleteTerminalBefore(
            @Param("terminalStatuses") List<DuelInviteStatus> terminalStatuses,
            @Param("cutoff") Instant cutoff);
}
