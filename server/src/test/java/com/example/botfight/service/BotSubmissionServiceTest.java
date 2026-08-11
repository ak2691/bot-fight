package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.BotSubmissionStatus;
import com.example.botfight.domain.BuildingSession;
import com.example.botfight.domain.ValidationResult;
import com.example.botfight.domain.ValidationStatus;
import com.example.botfight.repository.BotSubmissionRepository;
import com.example.botfight.repository.BuildingSessionRepository;
import com.example.botfight.repository.ValidationResultRepository;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.context.ApplicationEventPublisher;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class BotSubmissionServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final BotSubmissionRepository botSubmissionRepository =
            org.mockito.Mockito.mock(BotSubmissionRepository.class);
    private final BuildingSessionRepository buildingSessionRepository =
            org.mockito.Mockito.mock(BuildingSessionRepository.class);
    private final ValidationResultRepository validationResultRepository =
            org.mockito.Mockito.mock(ValidationResultRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final BotSubmissionRateLimiter rateLimiter = org.mockito.Mockito.mock(BotSubmissionRateLimiter.class);
    private final MatchService matchService = org.mockito.Mockito.mock(MatchService.class);
    private final ApplicationEventPublisher eventPublisher = org.mockito.Mockito.mock(ApplicationEventPublisher.class);
    private final BotSubmissionService service = new BotSubmissionService(
            new BotSubmissionValidationService(
                    jsonMapper,
                    new GameConfigCatalog()),
            botSubmissionRepository,
            buildingSessionRepository,
            validationResultRepository,
            currentUserService,
            rateLimiter,
            matchService,
            eventPublisher,
            jsonMapper);

    @Test
    void persistsAcceptedSubmissionWithFullBrainPayload() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        UUID buildingSessionId = UUID.randomUUID();
        stubOwnedBuildingSession(buildingSessionId, user);
        BotSubmissionPayloadDTO payload = validPayload(buildingSessionId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        assertThat(response.isBuildingDurationTrusted()).isTrue();

        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        BotSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getUser()).isSameAs(user);
        assertThat(savedSubmission.getBrainSchemaVersion()).isEqualTo("bot-logic-tree-v1");
        assertThat(savedSubmission.getBuildingSessionId()).isEqualTo(buildingSessionId.toString());
        assertThat(savedSubmission.getBrainPayload()).contains("\"move_walk\"");
        assertThat(savedSubmission.getStatus()).isEqualTo(BotSubmissionStatus.VALIDATED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        ValidationResult savedResult = resultCaptor.getValue();
        assertThat(savedResult.getBotSubmission()).isSameAs(savedSubmission);
        assertThat(savedResult.getStatus()).isEqualTo(ValidationStatus.ACCEPTED);
        assertThat(savedResult.getValidatorVersion()).isEqualTo("bot-brain-submission-v1");
    }

    @Test
    void rejectsSubmissionForBuildingSessionOwnedByAnotherUser() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        UUID buildingSessionId = UUID.randomUUID();
        when(buildingSessionRepository.findByIdAndUserIdForSubmission(buildingSessionId, user.getId()))
                .thenReturn(Optional.empty());

        var response = service.submit(validPayload(buildingSessionId), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("buildingSessionId was not found for this user");

        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(BotSubmissionStatus.REJECTED);
    }

    @Test
    void persistsRejectedSubmissionWithoutViolatingRequiredColumns() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setBuildingSessionId("x".repeat(150));

        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();

        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        BotSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getBrainSchemaVersion()).isEqualTo("missing-brain-schema");
        assertThat(savedSubmission.getBuildingSessionId()).hasSize(100);
        assertThat(savedSubmission.getStatus()).isEqualTo(BotSubmissionStatus.REJECTED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        assertThat(resultCaptor.getValue().getStatus()).isEqualTo(ValidationStatus.REJECTED);
        assertThat(resultCaptor.getValue().getRejectionCode()).isEqualTo("BOT_SUBMISSION_CONTRACT_FAILED");
    }

    @Test
    void persistsValidatorErrorsAsValidationResults() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        BotSubmissionValidationService failingValidationService =
                org.mockito.Mockito.mock(BotSubmissionValidationService.class);
        when(failingValidationService.validate(any(BotSubmissionPayloadDTO.class)))
                .thenThrow(new IllegalStateException("validator unavailable"));
        BotSubmissionService serviceWithFailingValidator = new BotSubmissionService(
                failingValidationService,
            botSubmissionRepository,
            buildingSessionRepository,
                validationResultRepository,
                currentUserService,
            rateLimiter,
                matchService,
            eventPublisher,
            jsonMapper);

        BotSubmissionPayloadDTO payload = validPayload(UUID.randomUUID());
        var response = serviceWithFailingValidator.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getStatus()).isEqualTo("ERROR");

        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(BotSubmissionStatus.REJECTED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        ValidationResult savedResult = resultCaptor.getValue();
        assertThat(savedResult.getStatus()).isEqualTo(ValidationStatus.ERROR);
        assertThat(savedResult.getRejectionCode()).isEqualTo("BOT_SUBMISSION_VALIDATION_ERROR");
        assertThat(savedResult.getDetails()).contains("validator error: IllegalStateException");
    }

    @Test
    void acceptsDuplicateBrainHash() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID buildingSessionId = UUID.randomUUID();
        stubOwnedBuildingSession(buildingSessionId, user);
        var response = service.submit(validPayload(buildingSessionId), authentication);

        assertThat(response.isAccepted()).isTrue();

        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(BotSubmissionStatus.VALIDATED);
    }

    @Test
    void exactSubmissionRetryReturnsOriginalSubmissionWithoutAnotherWrite() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID buildingSessionId = UUID.randomUUID();
        stubOwnedBuildingSession(buildingSessionId, user);
        BotSubmissionPayloadDTO payload = validPayload(buildingSessionId);

        service.submit(payload, authentication);
        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        when(botSubmissionRepository.findByUserIdAndBuildingSessionIdAndRequestFingerprintIsNotNull(
                user.getId(), buildingSessionId.toString()))
                .thenReturn(Optional.of(submissionCaptor.getValue()));

        var retryResponse = service.submit(payload, authentication);

        assertThat(retryResponse.isAccepted()).isTrue();
        verify(botSubmissionRepository, times(1)).save(any(BotSubmission.class));
        verify(validationResultRepository, times(1)).save(any(ValidationResult.class));
        verify(rateLimiter, times(1)).requireAllowed(user.getId());
    }

    @Test
    void reusedBuildingSessionWithDifferentPayloadIsRejectedAsConflict() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID buildingSessionId = UUID.randomUUID();
        stubOwnedBuildingSession(buildingSessionId, user);
        BotSubmissionPayloadDTO originalPayload = validPayload(buildingSessionId);

        service.submit(originalPayload, authentication);
        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        when(botSubmissionRepository.findByUserIdAndBuildingSessionIdAndRequestFingerprintIsNotNull(
                user.getId(), buildingSessionId.toString()))
                .thenReturn(Optional.of(submissionCaptor.getValue()));
        BotSubmissionPayloadDTO conflictingPayload = validPayload(buildingSessionId);
        conflictingPayload.setClientBuildVersion("different-build");

        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.submit(conflictingPayload, authentication))
                .isInstanceOf(SubmissionConflictException.class)
                .hasMessage("This building session already has a different bot submission");
        verify(botSubmissionRepository, times(1)).save(any(BotSubmission.class));
    }

    @Test
    void persistsAcceptedMatchBoundSubmission() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID buildingSessionId = UUID.randomUUID();
        stubOwnedBuildingSession(buildingSessionId, user, matchId);

        BotSubmissionPayloadDTO payload = validPayload(buildingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        ArgumentCaptor<BotSubmission> submissionCaptor = ArgumentCaptor.forClass(BotSubmission.class);
        verify(botSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getMatchId()).isEqualTo(matchId);
        org.mockito.Mockito.verify(matchService).requireActiveMatchForUser(user.getId(), matchId);
        org.mockito.Mockito.verify(matchService).markFinished(user.getId(), submissionId);
        verify(eventPublisher).publishEvent(any(MatchmakingEventsReady.class));
    }

    @Test
    void rejectsMatchSubmissionUsingBuildingSessionFromAnotherContext() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID buildingSessionId = UUID.randomUUID();
        stubOwnedBuildingSession(buildingSessionId, user, null);

        BotSubmissionPayloadDTO payload = validPayload(buildingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("buildingSessionId is not assigned to this match");
    }

    @Test
    void rateLimitStopsSubmissionBeforePersistence() {
        AppUser user = testUser();
        Authentication authentication = authenticatedUser(user);
        org.mockito.Mockito.doThrow(new RateLimitExceededException(
                "Too many bot submissions. Please retry shortly.",
                java.time.Duration.ofMillis(500)))
                .when(rateLimiter).requireAllowed(user.getId());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.submit(null, authentication))
                .isInstanceOf(RateLimitExceededException.class);

        verify(botSubmissionRepository, never()).save(any(BotSubmission.class));
        verify(validationResultRepository, never()).save(any(ValidationResult.class));
    }

    private BotSubmissionPayloadDTO validPayload(UUID buildingSessionId) throws Exception {
        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setBuildingSessionId(buildingSessionId.toString());
        payload.setSelectedLoadout("melee");

        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "bot-logic-tree-v1",
                  "roots": [{"createdOrder":0,"branches":[
                    {"id":"node-1","createdOrder":0,"branchType":"if","actions":[{"action":"move_walk","movementMode":"target","movementDirection":"toward"}],"conditions":[],"children":[]}
                  ]}]
                }
                """);
        payload.setBrain(brain);
        payload.setClientBuildVersion("test");
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

    private void stubSavedSubmissionId(UUID submissionId) throws Exception {
        when(botSubmissionRepository.save(any(BotSubmission.class))).thenAnswer(invocation -> {
            BotSubmission submission = invocation.getArgument(0);
            setId(submission, submissionId);
            return submission;
        });
    }

    private void stubOwnedBuildingSession(UUID buildingSessionId, AppUser user) throws Exception {
        stubOwnedBuildingSession(buildingSessionId, user, null);
    }

    private void stubOwnedBuildingSession(UUID buildingSessionId, AppUser user, UUID matchId) throws Exception {
        BuildingSession session = new BuildingSession();
        setId(session, buildingSessionId);
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(buildingSessionRepository.findByIdAndUserId(buildingSessionId, user.getId()))
                .thenReturn(Optional.of(session));
        when(buildingSessionRepository.findByIdAndUserIdForSubmission(buildingSessionId, user.getId()))
                .thenReturn(Optional.of(session));
    }

    private void setId(BotSubmission submission, UUID id) throws Exception {
        Field idField = BotSubmission.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(submission, id);
    }

    private void setId(BuildingSession session, UUID id) throws Exception {
        Field idField = BuildingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}
