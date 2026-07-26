package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.ModelSubmissionPayloadDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.ModelSubmission;
import com.example.botfight.domain.ModelSubmissionStatus;
import com.example.botfight.domain.TrainingSession;
import com.example.botfight.domain.ValidationResult;
import com.example.botfight.domain.ValidationStatus;
import com.example.botfight.repository.ModelSubmissionRepository;
import com.example.botfight.repository.TrainingSessionRepository;
import com.example.botfight.repository.ValidationResultRepository;
import com.example.botfight.simulation.combat.CombatCatalog;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final ModelSubmissionRepository modelSubmissionRepository =
            org.mockito.Mockito.mock(ModelSubmissionRepository.class);
    private final TrainingSessionRepository trainingSessionRepository =
            org.mockito.Mockito.mock(TrainingSessionRepository.class);
    private final ValidationResultRepository validationResultRepository =
            org.mockito.Mockito.mock(ValidationResultRepository.class);
    private final CurrentUserService currentUserService = org.mockito.Mockito.mock(CurrentUserService.class);
    private final ModelSubmissionRateLimiter rateLimiter = org.mockito.Mockito.mock(ModelSubmissionRateLimiter.class);
    private final MatchService matchService = org.mockito.Mockito.mock(MatchService.class);
    private final ModelSubmissionService service = new ModelSubmissionService(
            new ModelSubmissionValidationService(
                    jsonMapper,
                    new CombatCatalog()),
            modelSubmissionRepository,
            trainingSessionRepository,
            validationResultRepository,
            currentUserService,
            rateLimiter,
            matchService,
            jsonMapper);

    @Test
    void persistsAcceptedSubmissionWithFullBrainPayload() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user);
        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);
        assertThat(response.isTrainingDurationTrusted()).isTrue();

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        ModelSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getUser()).isSameAs(user);
        assertThat(savedSubmission.getBrainSchemaVersion()).isEqualTo("melee-logic-tree-v1");
        assertThat(savedSubmission.getTrainingSessionId()).isEqualTo(trainingSessionId.toString());
        assertThat(savedSubmission.getBrainPayload()).contains("\"move_inward\"");
        assertThat(savedSubmission.getStatus()).isEqualTo(ModelSubmissionStatus.VALIDATED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        ValidationResult savedResult = resultCaptor.getValue();
        assertThat(savedResult.getModelSubmission()).isSameAs(savedSubmission);
        assertThat(savedResult.getStatus()).isEqualTo(ValidationStatus.ACCEPTED);
        assertThat(savedResult.getValidatorVersion()).isEqualTo("bot-brain-submission-v1");
        assertThat(savedResult.getDetails()).doesNotContain("ModelHash");
    }

    @Test
    void rejectsSubmissionForTrainingSessionOwnedByAnotherUser() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        UUID trainingSessionId = UUID.randomUUID();
        when(trainingSessionRepository.findByIdAndUserIdForSubmission(trainingSessionId, user.getId()))
                .thenReturn(Optional.empty());

        var response = service.submit(validPayload(trainingSessionId), authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("trainingSessionId was not found for this user");

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);
    }

    @Test
    void persistsRejectedSubmissionWithoutViolatingRequiredColumns() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);

        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion(null);
        payload.setFeatureSchemaVersion(null);
        payload.setActionSchemaVersion(null);
        payload.setTrainingSessionId("x".repeat(150));
        payload.setTrainingSteps(-1);
        payload.setTrainingMetrics(jsonMapper.readTree("{}"));

        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        ModelSubmission savedSubmission = submissionCaptor.getValue();
        assertThat(savedSubmission.getBrainSchemaVersion()).isEqualTo("missing-brain-schema");
        assertThat(savedSubmission.getTrainingSessionId()).hasSize(100);
        assertThat(savedSubmission.getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        assertThat(resultCaptor.getValue().getStatus()).isEqualTo(ValidationStatus.REJECTED);
        assertThat(resultCaptor.getValue().getRejectionCode()).isEqualTo("MODEL_SUBMISSION_CONTRACT_FAILED");
    }

    @Test
    void persistsValidatorErrorsAsValidationResults() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        ModelSubmissionValidationService failingValidationService =
                org.mockito.Mockito.mock(ModelSubmissionValidationService.class);
        when(failingValidationService.validate(any(ModelSubmissionPayloadDTO.class)))
                .thenThrow(new IllegalStateException("validator unavailable"));
        ModelSubmissionService serviceWithFailingValidator = new ModelSubmissionService(
                failingValidationService,
            modelSubmissionRepository,
            trainingSessionRepository,
                validationResultRepository,
                currentUserService,
                rateLimiter,
                matchService,
            jsonMapper);

        ModelSubmissionPayloadDTO payload = validPayload(UUID.randomUUID());
        var response = serviceWithFailingValidator.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getStatus()).isEqualTo("ERROR");
        assertThat(response.getModelSubmissionId()).isEqualTo(submissionId);

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(ModelSubmissionStatus.REJECTED);

        ArgumentCaptor<ValidationResult> resultCaptor = ArgumentCaptor.forClass(ValidationResult.class);
        verify(validationResultRepository).save(resultCaptor.capture());
        ValidationResult savedResult = resultCaptor.getValue();
        assertThat(savedResult.getStatus()).isEqualTo(ValidationStatus.ERROR);
        assertThat(savedResult.getRejectionCode()).isEqualTo("MODEL_SUBMISSION_VALIDATION_ERROR");
        assertThat(savedResult.getDetails()).contains("validator error: IllegalStateException");
    }

    @Test
    void acceptsDuplicateBrainHash() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user);
        var response = service.submit(validPayload(trainingSessionId), authentication);

        assertThat(response.isAccepted()).isTrue();

        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getStatus()).isEqualTo(ModelSubmissionStatus.VALIDATED);
    }

    @Test
    void exactSubmissionRetryReturnsOriginalSubmissionWithoutAnotherWrite() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user);
        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);

        var firstResponse = service.submit(payload, authentication);
        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        when(modelSubmissionRepository.findByUserIdAndTrainingSessionIdAndRequestFingerprintIsNotNull(
                user.getId(), trainingSessionId.toString()))
                .thenReturn(Optional.of(submissionCaptor.getValue()));

        var retryResponse = service.submit(payload, authentication);

        assertThat(retryResponse.getModelSubmissionId()).isEqualTo(firstResponse.getModelSubmissionId());
        assertThat(retryResponse.isAccepted()).isTrue();
        verify(modelSubmissionRepository, times(1)).save(any(ModelSubmission.class));
        verify(validationResultRepository, times(1)).save(any(ValidationResult.class));
        verify(rateLimiter, times(1)).requireAllowed(user.getId());
    }

    @Test
    void reusedTrainingSessionWithDifferentPayloadIsRejectedAsConflict() throws Exception {
        UUID submissionId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user);
        ModelSubmissionPayloadDTO originalPayload = validPayload(trainingSessionId);

        service.submit(originalPayload, authentication);
        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        when(modelSubmissionRepository.findByUserIdAndTrainingSessionIdAndRequestFingerprintIsNotNull(
                user.getId(), trainingSessionId.toString()))
                .thenReturn(Optional.of(submissionCaptor.getValue()));
        ModelSubmissionPayloadDTO conflictingPayload = validPayload(trainingSessionId);
        conflictingPayload.setTrainingSteps(1);

        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.submit(conflictingPayload, authentication))
                .isInstanceOf(SubmissionConflictException.class)
                .hasMessage("This training session already has a different model submission");
        verify(modelSubmissionRepository, times(1)).save(any(ModelSubmission.class));
    }

    @Test
    void persistsAcceptedMatchBoundSubmission() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user, matchId);

        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isTrue();
        ArgumentCaptor<ModelSubmission> submissionCaptor = ArgumentCaptor.forClass(ModelSubmission.class);
        verify(modelSubmissionRepository).save(submissionCaptor.capture());
        assertThat(submissionCaptor.getValue().getMatchId()).isEqualTo(matchId);
        org.mockito.Mockito.verify(matchService).requireActiveMatchForUser(user.getId(), matchId);
    }

    @Test
    void rejectsMatchSubmissionUsingTrainingSessionFromAnotherContext() throws Exception {
        UUID submissionId = UUID.randomUUID();
        UUID matchId = UUID.randomUUID();
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        stubSavedSubmissionId(submissionId);
        UUID trainingSessionId = UUID.randomUUID();
        stubOwnedTrainingSession(trainingSessionId, user, null);

        ModelSubmissionPayloadDTO payload = validPayload(trainingSessionId);
        payload.setMatchId(matchId);
        var response = service.submit(payload, authentication);

        assertThat(response.isAccepted()).isFalse();
        assertThat(response.getErrors()).contains("trainingSessionId is not assigned to this match");
    }

    @Test
    void rateLimitStopsSubmissionBeforePersistence() {
        AppUser user = prototypeUser();
        Authentication authentication = authenticatedUser(user);
        org.mockito.Mockito.doThrow(new RateLimitExceededException(
                "Too many model submissions. Please retry shortly.",
                java.time.Duration.ofMillis(500)))
                .when(rateLimiter).requireAllowed(user.getId());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.submit(null, authentication))
                .isInstanceOf(RateLimitExceededException.class);

        verify(modelSubmissionRepository, never()).save(any(ModelSubmission.class));
        verify(validationResultRepository, never()).save(any(ValidationResult.class));
    }

    private ModelSubmissionPayloadDTO validPayload(UUID trainingSessionId) throws Exception {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion("deterministic-logic-v1");
        payload.setFeatureSchemaVersion("duel-logic-features-v1");
        payload.setActionSchemaVersion("melee-logic-actions-v1");
        payload.setModelFormat("logic-blocks-v1");
        payload.setTrainingSessionId(trainingSessionId.toString());
        payload.setTrainingDurationMs(null);
        payload.setTrainingSteps(0);
        payload.setSelectedClass("melee");
        payload.setBaseModelArtifactId("logic-brain-v1");
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"version":"deterministic-logic-check-v1","trainingSamples":0,"epochsCompleted":0}
                """));

        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "melee-logic-tree-v1",
                  "blocks": [
                    {"id":"block-1","action":"move_inward","conditions":[]}
                  ]
                }
                """);
        payload.setBrain(brain);
        payload.setClientBuildVersion("test");
        return payload;
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

    private void stubSavedSubmissionId(UUID submissionId) throws Exception {
        when(modelSubmissionRepository.save(any(ModelSubmission.class))).thenAnswer(invocation -> {
            ModelSubmission submission = invocation.getArgument(0);
            setId(submission, submissionId);
            return submission;
        });
    }

    private void stubOwnedTrainingSession(UUID trainingSessionId, AppUser user) throws Exception {
        stubOwnedTrainingSession(trainingSessionId, user, null);
    }

    private void stubOwnedTrainingSession(UUID trainingSessionId, AppUser user, UUID matchId) throws Exception {
        TrainingSession session = new TrainingSession();
        setId(session, trainingSessionId);
        session.setUser(user);
        session.setMatchId(matchId);
        session.setStartedAt(Instant.now().minusSeconds(2));
        when(trainingSessionRepository.findByIdAndUserId(trainingSessionId, user.getId()))
                .thenReturn(Optional.of(session));
        when(trainingSessionRepository.findByIdAndUserIdForSubmission(trainingSessionId, user.getId()))
                .thenReturn(Optional.of(session));
    }

    private void setId(ModelSubmission submission, UUID id) throws Exception {
        Field idField = ModelSubmission.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(submission, id);
    }

    private void setId(TrainingSession session, UUID id) throws Exception {
        Field idField = TrainingSession.class.getDeclaredField("id");
        idField.setAccessible(true);
        idField.set(session, id);
    }
}
