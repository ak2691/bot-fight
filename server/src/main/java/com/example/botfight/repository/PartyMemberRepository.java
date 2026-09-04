package com.example.botfight.repository;

import com.example.botfight.domain.party.PartyMember;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PartyMemberRepository extends JpaRepository<PartyMember, UUID> {

    List<PartyMember> findByPartyIdOrderBySlotAsc(UUID partyId);

    Optional<PartyMember> findByPartyIdAndUserId(UUID partyId, UUID userId);

    boolean existsByUserId(UUID userId);
}
