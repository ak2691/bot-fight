package com.example.botfight.service;

import com.example.botfight.DTO.TestingSessionResponseDTO;
import com.example.botfight.domain.TestingSession;
import com.example.botfight.repository.TestingSessionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TestingSessionService {

    private final TestingSessionRepository testingSessionRepository;
    private final CurrentUserService currentUserService;
    private final MatchService matchService;

    public TestingSessionService(
            TestingSessionRepository testingSessionRepository,
            CurrentUserService currentUserService,
            MatchService matchService) {
        this.testingSessionRepository = testingSessionRepository;
        this.currentUserService = currentUserService;
        this.matchService = matchService;
    }

    @Transactional
    public TestingSessionResponseDTO createSession(Authentication authentication, UUID matchId) {
        var user = currentUserService.requireCurrentUser(authentication);
        if (matchId != null) {
            matchService.requireActiveMatchForUser(user.getId(), matchId);
        }

        TestingSession session = new TestingSession();
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now());

        TestingSession savedSession = testingSessionRepository.save(session);
        return toResponse(savedSession, 0L, "Testing session started");
    }

    @Transactional(readOnly = true)
    public TestingSessionResponseDTO getDuration(UUID testingSessionId, Authentication authentication) {
        TestingSession session = testingSessionRepository
                .findByIdAndUserId(testingSessionId, currentUserService.requireCurrentUser(authentication).getId())
                .orElseThrow(() -> new TestingSessionNotFoundException(testingSessionId));
        long durationMs = Math.max(0, Duration.between(session.getStartedAt(), Instant.now()).toMillis());
        return toResponse(session, durationMs, "Server-owned testing duration");
    }

    private TestingSessionResponseDTO toResponse(
            TestingSession session,
            Long testingDurationMs,
            String message) {
        TestingSessionResponseDTO response = new TestingSessionResponseDTO();
        response.setTestingSessionId(session.getId());
        response.setMatchId(session.getMatchId());
        response.setStartedAt(session.getStartedAt());
        response.setTestingDurationMs(testingDurationMs);
        response.setTrusted(true);
        response.setMessage(message);
        return response;
    }

}
