package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.BuildingSession;
import com.example.botfight.repository.BuildingSessionRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;

class BuildingSessionServiceTest {

    private final BuildingSessionRepository buildingSessionRepository =
            org.mockito.Mockito.mock(BuildingSessionRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final MatchService matchService = org.mockito.Mockito.mock(MatchService.class);
    private final BuildingSessionService service =
            new BuildingSessionService(buildingSessionRepository, currentUserService, matchService);

    @Test
    void createsServerOwnedBuildingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(buildingSessionRepository.save(any(BuildingSession.class))).thenAnswer(invocation -> {
            BuildingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication, null);

        assertThat(response.buildingSessionId()).isEqualTo(sessionId);
        assertThat(response.matchId()).isNull();
        assertThat(response.startedAt()).isNotNull();
        assertThat(response.buildingDurationMs()).isZero();
        assertThat(response.trusted()).isTrue();
    }

    @Test
    void createsMatchBoundBuildingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(buildingSessionRepository.save(any(BuildingSession.class))).thenAnswer(invocation -> {
            BuildingSession session = invocation.getArgument(0);
            setId(session, sessionId);
            return session;
        });

        var response = service.createSession(authentication, matchId);

        assertThat(response.buildingSessionId()).isEqualTo(sessionId);
        assertThat(response.matchId()).isEqualTo(matchId);
        org.mockito.Mockito.verify(matchService).requireActiveMatchForUser(user.getId(), matchId);
    }

    @Test
    void returnsTrustedDurationForExistingSession() throws Exception {
        UUID sessionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        BuildingSession session = new BuildingSession();
        setId(session, sessionId);
        session.setUser(user);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(buildingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.of(session));

        var response = service.getDuration(sessionId, authentication);

        assertThat(response.buildingSessionId()).isEqualTo(sessionId);
        assertThat(response.buildingDurationMs()).isGreaterThanOrEqualTo(0);
        assertThat(response.trusted()).isTrue();
    }

    @Test
    void rejectsUnknownSessionDurationLookup() {
        UUID sessionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(buildingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId, authentication))
                .isInstanceOf(BuildingSessionNotFoundException.class)
                .hasMessageContaining(sessionId.toString());
    }

    @Test
    void rejectsDurationLookupForAnotherUsersSessionAsNotFound() {
        UUID sessionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(buildingSessionRepository.findByIdAndUserId(sessionId, user.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getDuration(sessionId, authentication))
                .isInstanceOf(BuildingSessionNotFoundException.class);
    }

    private AppUser testUser() {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername("test-local-player");
        user.setEmail("test@example.test");
        user.setNormalizedEmail("test@example.test");
        return user;
    }

    private Authentication authenticatedUser(AppUser user) {
        Authentication authentication = new UsernamePasswordAuthenticationToken("test", null);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        return authentication;
    }

    private void setId(BuildingSession session, UUID id) throws Exception {
        Field idField = BuildingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}
