package com.example.botfight.repository;

import com.example.botfight.domain.PartyInvite;
import com.example.botfight.domain.PartyInviteStatus;
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

public interface PartyInviteRepository extends JpaRepository<PartyInvite, UUID> {

    @Query("""
            select invite
            from PartyInvite invite
            where invite.party.id = :partyId
              and invite.invitee.id = :inviteeId
              and invite.status = :status
            order by invite.createdAt desc
            """)
    List<PartyInvite> findByPartyIdAndInviteeIdAndStatus(
            @Param("partyId") UUID partyId,
            @Param("inviteeId") UUID inviteeId,
            @Param("status") PartyInviteStatus status);

    List<PartyInvite> findByInviteeIdAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
            UUID inviteeId,
            PartyInviteStatus status,
            Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select invite
            from PartyInvite invite
            where invite.id = :inviteId
              and invite.invitee.id = :inviteeId
            """)
    Optional<PartyInvite> findForInviteeForUpdate(
            @Param("inviteId") UUID inviteId,
            @Param("inviteeId") UUID inviteeId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
            update PartyInvite invite
               set invite.status = :expiredStatus,
                   invite.respondedAt = :now
             where invite.party.id = :partyId
               and invite.status = :pendingStatus
            """)
    int expirePendingForParty(
            @Param("partyId") UUID partyId,
            @Param("pendingStatus") PartyInviteStatus pendingStatus,
            @Param("expiredStatus") PartyInviteStatus expiredStatus,
            @Param("now") Instant now);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
            update PartyInvite invite
               set invite.status = :expiredStatus,
                   invite.respondedAt = :now
             where invite.status = :pendingStatus
               and invite.expiresAt <= :now
            """)
    int expirePendingBefore(
            @Param("pendingStatus") PartyInviteStatus pendingStatus,
            @Param("expiredStatus") PartyInviteStatus expiredStatus,
            @Param("now") Instant now);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
            delete from PartyInvite invite
             where invite.status in :terminalStatuses
               and invite.expiresAt <= :cutoff
            """)
    int deleteTerminalBefore(
            @Param("terminalStatuses") List<PartyInviteStatus> terminalStatuses,
            @Param("cutoff") Instant cutoff);
}
