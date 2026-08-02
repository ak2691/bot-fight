package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.TestingSession;
import com.example.botfight.repository.TestingSessionRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

class TestingSessionServiceTest {

    private final TestingSessionRepository testingSessionRepository =
            org.mockito.Mockito.mock(TestingSessionRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final MatchService matchService = org.mockito.Mockito.mock(MatchService.class);
    private final TestingSessionService service =
            new TestingSessionService(testingSessionRepository, currentUserService, matchService);

    @Test
    void createsServerOwnedTestingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(testingSessionRepository.save(any(TestingSession.class))).thenAnswer(invocation -> {
            TestingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication, null);

        assertThat(response.getTestingSessionId()).isEqualTo(sessionId);
        assertThat(response.getMatchId()).isNull();
        assertThat(response.getStartedAt()).isNotNull();
        assertThat(response.getTestingDurationMs()).isZero();
        assertThat(response.isTrusted()).isTrue();
    }

    @Test
    void createsMatchBoundTestingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(testingSessionRepository.save(any(TestingSession.class))).thenAnswer(invocation -> {
            TestingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication, matchId);

        assertThat(response.getTestingSessionId()).isEqualTo(sessionId);
        assertThat(response.getMatchId()).isEqualTo(matchId);
        org.mockito.Mockito.verify(matchService).requireActiveMatchForUser(user.getId(), matchId);
    }

    @Test
    void returnsTrustedDurationForExistingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        TestingSession session = new TestingSession();
        setId(session, sessionId);
        session.setUser(user);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(testingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.of(session));

        var response = service.getDuration(sessionId, authentication);

        assertThat(response.getTestingSessionId()).isEqualTo(sessionId);
        assertThat(response.getTestingDurationMs()).isGreaterThanOrEqualTo(0);
        assertThat(response.isTrusted()).isTrue();
    }

    @Test
    void rejectsUnknownSessionDurationLookup() {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(testingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId, authentication))
                .isInstanceOf(TestingSessionNotFoundException.class)
                .hasMessageContaining(sessionId.toString());
    }

    @Test
    void rejectsDurationLookupForAnotherUsersSessionAsNotFound() {
        UUID sessionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        when(testingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId, authentication))
                .isInstanceOf(TestingSessionNotFoundException.class);
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

    private void setId(TestingSession session, UUID id) throws Exception {
        Field idField = TestingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}
