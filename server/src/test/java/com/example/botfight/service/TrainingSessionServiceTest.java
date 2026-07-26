package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.TrainingSession;
import com.example.botfight.repository.TrainingSessionRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

class TrainingSessionServiceTest {

    private final TrainingSessionRepository trainingSessionRepository =
            org.mockito.Mockito.mock(TrainingSessionRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final MatchService matchService = org.mockito.Mockito.mock(MatchService.class);
    private final TrainingSessionService service =
            new TrainingSessionService(trainingSessionRepository, currentUserService, matchService);

    @Test
    void createsServerOwnedTrainingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(trainingSessionRepository.save(any(TrainingSession.class))).thenAnswer(invocation -> {
            TrainingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication, null);

        assertThat(response.getTrainingSessionId()).isEqualTo(sessionId);
        assertThat(response.getMatchId()).isNull();
        assertThat(response.getStartedAt()).isNotNull();
        assertThat(response.getTrainingDurationMs()).isZero();
        assertThat(response.isTrusted()).isTrue();
    }

    @Test
    void createsMatchBoundTrainingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(trainingSessionRepository.save(any(TrainingSession.class))).thenAnswer(invocation -> {
            TrainingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication, matchId);

        assertThat(response.getTrainingSessionId()).isEqualTo(sessionId);
        assertThat(response.getMatchId()).isEqualTo(matchId);
        org.mockito.Mockito.verify(matchService).requireActiveMatchForUser(user.getId(), matchId);
    }

    @Test
    void returnsTrustedDurationForExistingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        TrainingSession session = new TrainingSession();
        setId(session, sessionId);
        session.setUser(user);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(trainingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.of(session));

        var response = service.getDuration(sessionId, authentication);

        assertThat(response.getTrainingSessionId()).isEqualTo(sessionId);
        assertThat(response.getTrainingDurationMs()).isGreaterThanOrEqualTo(0);
        assertThat(response.isTrusted()).isTrue();
    }

    @Test
    void rejectsUnknownSessionDurationLookup() {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(trainingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId, authentication))
                .isInstanceOf(TrainingSessionNotFoundException.class)
                .hasMessageContaining(sessionId.toString());
    }

    @Test
    void rejectsDurationLookupForAnotherUsersSessionAsNotFound() {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(trainingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId, authentication))
                .isInstanceOf(TrainingSessionNotFoundException.class);
    }

    private AppUser prototypeUser() {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername("prototype-local-player");
        user.setEmail("prototype@example.test");
        user.setNormalizedEmail("prototype@example.test");
        return user;
    }

    private Authentication authenticatedUser(AppUser user) {
        Authentication authentication = new UsernamePasswordAuthenticationToken("test", null);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        return authentication;
    }

    private void setId(TrainingSession session, UUID id) throws Exception {
        Field idField = TrainingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}
