package com.example.botfight.repository;

import com.example.botfight.domain.party.Party;
import com.example.botfight.domain.party.PartyStatus;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface PartyRepository extends JpaRepository<Party, UUID> {

    @Query("""
            select party
            from Party party
            join PartyMember member on member.party.id = party.id
            where member.user.id = :userId
              and party.status = :status
            """)
    Optional<Party> findByMemberUserIdAndStatus(
            @Param("userId") UUID userId,
            @Param("status") PartyStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select party from Party party where party.id = :partyId")
    Optional<Party> findByIdForUpdate(@Param("partyId") UUID partyId);
}
