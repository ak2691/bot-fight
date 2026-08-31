package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchSubmissionResult;
import com.example.botfight.service.matchmaking.MatchmakingEventsReady;
import com.example.botfight.service.submission.BotSubmissionService;
import com.example.botfight.service.submission.BotSubmissionValidationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class BotSubmissionServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final SlidingWindowRateLimiter<UUID> rateLimiter = org.mockito.Mockito.mock(SlidingWindowRateLimiter.class);
    private final MatchService matchService = org.mockito.Mockito.mock(MatchService.class);
    private final ApplicationEventPublisher eventPublisher = org.mockito.Mockito.mock(ApplicationEventPublisher.class);
    private final BotSubmissionService service = new BotSubmissionService(
            new BotSubmissionValidationService(jsonMapper, new GameConfigCatalog()),
            currentUserService,
            rateLimiter,
            matchService,
            eventPublisher,
            jsonMapper);

    @Test
    void rejectsNonMatchSubmissionWithoutCallingPersistenceOrMatchServices() throws Exception {
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);

        var response = service.submit(validPayload(null), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("bot submissions require an active match");
        verify(matchService, never()).isCurrentMatchSubmission(any(), any(), any(), any());
        verify(rateLimiter, never()).requireAllowed(any());
        verify(eventPublisher, never()).publishEvent(any(MatchmakingEventsReady.class));
    }

    @Test
    void acceptsValidatedMatchSubmissionWithoutPersistence() throws Exception {
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(matchService.isCurrentMatchSubmission(user.getId(), matchId, 1, "BUILDING"))
                .thenReturn(true);
        when(matchService.acceptMatchSubmission(
                eq(user.getId()), eq(matchId), eq(1), eq("BUILDING"), any(BotSubmission.class)))
                .thenReturn(MatchSubmissionResult.accepted(List.of()));

        var response = service.submit(validPayload(matchId), authentication);

        assertThat(response.isAccepted()).isTrue();
        verify(rateLimiter).requireAllowed(user.getId());
        verify(matchService).acceptMatchSubmission(
                eq(user.getId()), eq(matchId), eq(1), eq("BUILDING"), any(BotSubmission.class));
        verify(eventPublisher).publishEvent(any(MatchmakingEventsReady.class));
    }

    @Test
    void preservesEditorNodePositionsInTheStoredBrainPayload() throws Exception {
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(matchService.isCurrentMatchSubmission(user.getId(), matchId, 1, "BUILDING"))
                .thenReturn(true);
        when(matchService.acceptMatchSubmission(
                eq(user.getId()), eq(matchId), eq(1), eq("BUILDING"), any(BotSubmission.class)))
                .thenReturn(MatchSubmissionResult.accepted(List.of()));

        BotSubmissionPayloadDTO payload = validPayload(matchId);
        ((tools.jackson.databind.node.ObjectNode) payload.getBrain()).set(
                "nodePositions",
                jsonMapper.readTree("{\"rootNode:root-1\":{\"x\":156,\"y\":50}}"));

        service.submit(payload, authentication);

        var captor = org.mockito.ArgumentCaptor.forClass(BotSubmission.class);
        verify(matchService).acceptMatchSubmission(
                eq(user.getId()), eq(matchId), eq(1), eq("BUILDING"), captor.capture());
        JsonNode storedBrain = jsonMapper.readTree(captor.getValue().getBrainPayload());
        assertThat(storedBrain.path("nodePositions").path("rootNode:root-1").path("x").asInt())
                .isEqualTo(156);
        assertThat(storedBrain.path("nodePositions").path("rootNode:root-1").path("y").asInt())
                .isEqualTo(50);
    }

    @Test
    void duplicateMatchSubmissionDoesNotPublishAnotherMatchEvent() throws Exception {
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(matchService.isCurrentMatchSubmission(user.getId(), matchId, 1, "BUILDING"))
                .thenReturn(true);
        when(matchService.acceptMatchSubmission(
                eq(user.getId()), eq(matchId), eq(1), eq("BUILDING"), any(BotSubmission.class)))
                .thenReturn(MatchSubmissionResult.duplicateResult());

        var response = service.submit(validPayload(matchId), authentication);

        assertThat(response.isAccepted()).isTrue();
        verify(eventPublisher, never()).publishEvent(any(MatchmakingEventsReady.class));
    }

    @Test
    void rejectsStaleMatchSubmissionBeforeValidation() throws Exception {
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        when(matchService.isCurrentMatchSubmission(user.getId(), matchId, 1, "BUILDING"))
                .thenReturn(false);

        var response = service.submit(validPayload(matchId), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains(
                "bot submission is stale because the match is no longer in this round's building phase");
        verify(rateLimiter, never()).requireAllowed(any());
        verify(matchService, never()).acceptMatchSubmission(any(), any(), any(), any(), any());
    }

    @Test
    void validatorFailureIsReturnedWithoutCreatingMatchState() throws Exception {
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        BotSubmissionValidationService failingValidator = org.mockito.Mockito.mock(BotSubmissionValidationService.class);
        when(matchService.isCurrentMatchSubmission(user.getId(), matchId, 1, "BUILDING"))
                .thenReturn(true);
        when(failingValidator.validate(any(BotSubmissionPayloadDTO.class)))
                .thenThrow(new IllegalStateException("validator unavailable"));
        BotSubmissionService failingService = new BotSubmissionService(
                failingValidator,
                currentUserService,
                rateLimiter,
                matchService,
                eventPublisher,
                jsonMapper);

        var response = failingService.submit(validPayload(matchId), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getStatus()).isEqualTo("ERROR");
        verify(matchService, never()).acceptMatchSubmission(any(), any(), any(), any(), any());
    }

    private BotSubmissionPayloadDTO validPayload(UUID matchId) throws Exception {
        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setMatchId(matchId);
        payload.setRoundNumber(matchId == null ? null : 1);
        payload.setPhase(matchId == null ? null : "BUILDING");
        payload.setSelectedLoadout("melee");
        payload.setClientBuildVersion("test");
        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "bot-logic-tree-v1",
                  "roots": [{"priority":1,"branches":[
                    {"id":"node-1","priority":1,"branchType":"if","actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"conditions":[],"children":[]}
                  ]}]
                }
                """);
        payload.setBrain(brain);
        return payload;
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
}
