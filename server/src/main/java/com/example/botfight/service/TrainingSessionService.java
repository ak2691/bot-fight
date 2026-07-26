package com.example.botfight.service;

import com.example.botfight.DTO.TrainingSessionResponseDTO;
import com.example.botfight.domain.TrainingSession;
import com.example.botfight.repository.TrainingSessionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TrainingSessionService {

    private final TrainingSessionRepository trainingSessionRepository;
    private final CurrentUserService currentUserService;
    private final MatchService matchService;

    public TrainingSessionService(
            TrainingSessionRepository trainingSessionRepository,
            CurrentUserService currentUserService,
            MatchService matchService) {
        this.trainingSessionRepository = trainingSessionRepository;
        this.currentUserService = currentUserService;
        this.matchService = matchService;
    }

    @Transactional
    public TrainingSessionResponseDTO createSession(Authentication authentication, UUID matchId) {
        var user = currentUserService.requireCurrentUser(authentication);
        if (matchId != null) {
            matchService.requireActiveMatchForUser(user.getId(), matchId);
        }

        TrainingSession session = new TrainingSession();
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now());

        TrainingSession savedSession = trainingSessionRepository.save(session);
        return toResponse(savedSession, 0L, "Training session started");
    }

    @Transactional(readOnly = true)
    public TrainingSessionResponseDTO getDuration(UUID trainingSessionId, Authentication authentication) {
        TrainingSession session = trainingSessionRepository
                .findByIdAndUserId(trainingSessionId, currentUserService.requireCurrentUser(authentication).getId())
                .orElseThrow(() -> new TrainingSessionNotFoundException(trainingSessionId));
        long durationMs = Math.max(0, Duration.between(session.getStartedAt(), Instant.now()).toMillis());
        return toResponse(session, durationMs, "Server-owned training duration");
    }

    private TrainingSessionResponseDTO toResponse(
            TrainingSession session,
            Long trainingDurationMs,
            String message) {
        TrainingSessionResponseDTO response = new TrainingSessionResponseDTO();
        response.setTrainingSessionId(session.getId());
        response.setMatchId(session.getMatchId());
        response.setStartedAt(session.getStartedAt());
        response.setTrainingDurationMs(trainingDurationMs);
        response.setTrusted(true);
        response.setMessage(message);
        return response;
    }

}
