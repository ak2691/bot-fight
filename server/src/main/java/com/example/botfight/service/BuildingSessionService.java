package com.example.botfight.service;

import com.example.botfight.DTO.BuildingSessionResponseDTO;
import com.example.botfight.domain.BuildingSession;
import com.example.botfight.repository.BuildingSessionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BuildingSessionService {

    private final BuildingSessionRepository buildingSessionRepository;
    private final CurrentUserService currentUserService;
    private final MatchService matchService;

    public BuildingSessionService(
            BuildingSessionRepository buildingSessionRepository,
            CurrentUserService currentUserService,
            MatchService matchService) {
        this.buildingSessionRepository = buildingSessionRepository;
        this.currentUserService = currentUserService;
        this.matchService = matchService;
    }

    @Transactional
    public BuildingSessionResponseDTO createSession(Authentication authentication, UUID matchId) {
        var user = currentUserService.requireCurrentUser(authentication);
        if (matchId != null) {
            matchService.requireActiveMatchForUser(user.getId(), matchId);
        }

        BuildingSession session = new BuildingSession();
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now());

        BuildingSession savedSession = buildingSessionRepository.save(session);
        return toResponse(savedSession, 0L, "Building session started");
    }

    @Transactional(readOnly = true)
    public BuildingSessionResponseDTO getDuration(UUID buildingSessionId, Authentication authentication) {
        BuildingSession session = buildingSessionRepository
                .findByIdAndUserId(buildingSessionId, currentUserService.requireCurrentUser(authentication).getId())
                .orElseThrow(() -> new BuildingSessionNotFoundException(buildingSessionId));
        long durationMs = Math.max(0, Duration.between(session.getStartedAt(), Instant.now()).toMillis());
        return toResponse(session, durationMs, "Server-owned building duration");
    }

    private BuildingSessionResponseDTO toResponse(
            BuildingSession session,
            Long buildingDurationMs,
            String message) {
        return new BuildingSessionResponseDTO(
                session.getId(), session.getMatchId(), session.getStartedAt(), buildingDurationMs, true, message);
    }

}
