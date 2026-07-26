package com.example.botfight.service;

import com.example.botfight.DTO.ModelSubmissionPayloadDTO;
import com.example.botfight.DTO.ModelSubmissionValidationResponseDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.ModelSubmission;
import com.example.botfight.domain.ModelSubmissionStatus;
import com.example.botfight.domain.TrainingSession;
import com.example.botfight.domain.ValidationResult;
import com.example.botfight.domain.ValidationStatus;
import com.example.botfight.repository.ModelSubmissionRepository;
import com.example.botfight.repository.TrainingSessionRepository;
import com.example.botfight.repository.ValidationResultRepository;
import java.time.Duration;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ModelSubmissionService {

    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TRAINING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_CLASS_LENGTH = 40;
    private static final String VALIDATOR_VERSION = "model-submission-stub-v1";

    private final ModelSubmissionValidationService validationService;
    private final ModelSubmissionRepository modelSubmissionRepository;
    private final TrainingSessionRepository trainingSessionRepository;
    private final ValidationResultRepository validationResultRepository;
    private final CurrentUserService currentUserService;
    private final ModelSubmissionRateLimiter rateLimiter;
    private final MatchService matchService;
    private final JsonMapper jsonMapper;

    public ModelSubmissionService(
            ModelSubmissionValidationService validationService,
            ModelSubmissionRepository modelSubmissionRepository,
            TrainingSessionRepository trainingSessionRepository,
            ValidationResultRepository validationResultRepository,
            CurrentUserService currentUserService,
            ModelSubmissionRateLimiter rateLimiter,
            MatchService matchService,
            JsonMapper jsonMapper) {
        this.validationService = validationService;
        this.modelSubmissionRepository = modelSubmissionRepository;
        this.trainingSessionRepository = trainingSessionRepository;
        this.validationResultRepository = validationResultRepository;
        this.currentUserService = currentUserService;
        this.rateLimiter = rateLimiter;
        this.matchService = matchService;
        this.jsonMapper = jsonMapper;
    }

    @Transactional
    public ModelSubmissionValidationResponseDTO submit(ModelSubmissionPayloadDTO payload, Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        ModelSubmissionValidationResponseDTO validation = validateSafely(payload);
        Integer trustedTrainingDurationMs = validateOwnedTrainingSession(payload, user, validation);
        validateMatchBinding(payload, user, validation);
        String requestFingerprint = requestFingerprint(payload);
        Optional<ModelSubmission> existingSubmission = findExistingSubmission(payload, user);
        if (existingSubmission.isPresent()) {
            return existingSubmissionResponse(existingSubmission.get(), requestFingerprint, validation);
        }

        rateLimiter.requireAllowed(user.getId());
        rejectDuplicateFinalHash(payload, validation);
        ModelSubmission submission = toSubmission(
                payload,
                validation,
                user,
                trustedTrainingDurationMs,
                requestFingerprint);

        ModelSubmission savedSubmission = modelSubmissionRepository.save(submission);
        validationResultRepository.save(toValidationResult(savedSubmission, validation));
        validation.setModelSubmissionId(savedSubmission.getId());

        return validation;
    }

    private Optional<ModelSubmission> findExistingSubmission(ModelSubmissionPayloadDTO payload, AppUser user) {
        if (payload == null || !hasText(payload.getTrainingSessionId())) {
            return Optional.empty();
        }
        return modelSubmissionRepository.findByUserIdAndTrainingSessionIdAndRequestFingerprintIsNotNull(
                user.getId(),
                submissionTrainingSessionKey(payload));
    }

    private ModelSubmissionValidationResponseDTO existingSubmissionResponse(
            ModelSubmission existing,
            String requestFingerprint,
            ModelSubmissionValidationResponseDTO validation) {
        if (existing.getRequestFingerprint() == null
                || !existing.getRequestFingerprint().equals(requestFingerprint)) {
            throw new SubmissionConflictException(
                    "This training session already has a different model submission");
        }

        boolean accepted = existing.getStatus() == ModelSubmissionStatus.VALIDATED;
        validation.setModelSubmissionId(existing.getId());
        validation.setAccepted(accepted);
        validation.setStatus(accepted ? "ACCEPTED" : "REJECTED");
        validation.setMessage(accepted ? "Bot brain passed validation" : "Bot brain failed validation");
        return validation;
    }

    private void rejectDuplicateFinalHash(
            ModelSubmissionPayloadDTO payload,
            ModelSubmissionValidationResponseDTO validation) {
        // Deterministic bot brains may intentionally be resubmitted unchanged across rounds.
    }

    private ModelSubmissionValidationResponseDTO validateSafely(ModelSubmissionPayloadDTO payload) {
        try {
            return validationService.validate(payload);
        } catch (Exception ex) {
            ModelSubmissionValidationResponseDTO response = new ModelSubmissionValidationResponseDTO();
            response.setAccepted(false);
            response.setStatus("ERROR");
            response.setMessage("Bot brain validation failed unexpectedly");
            response.setValidatorVersion(VALIDATOR_VERSION);
            response.setTrainingDurationTrusted(false);
            response.setErrors(List.of("validator error: " + ex.getClass().getSimpleName()));
            response.setWarnings(List.of());
            return response;
        }
    }

    private ModelSubmission toSubmission(
            ModelSubmissionPayloadDTO payload,
            ModelSubmissionValidationResponseDTO validation,
            AppUser user,
            Integer trustedTrainingDurationMs,
            String requestFingerprint) {
        ModelSubmission submission = new ModelSubmission();
        submission.setUser(user);
        submission.setRequestFingerprint(requestFingerprint);

        if (payload != null) {
            submission.setMatchId(payload.getMatchId());
            submission.setTrainingSessionId(submissionTrainingSessionKey(payload));
            submission.setSelectedClass(cleanNullableText(
                    payload.getSelectedClass(), MAX_SELECTED_CLASS_LENGTH));
            submission.setClientBuildVersion(cleanNullableText(
                    payload.getClientBuildVersion(), MAX_CLIENT_BUILD_VERSION_LENGTH));
            JsonNode brain = payload.getBrain();
            submission.setBrainSchemaVersion(cleanText(
                    brain != null ? brain.path("version").asText(null) : null,
                    "missing-brain-schema",
                    MAX_VERSION_LENGTH));
            submission.setBrainPayload(toJson(brain, "{}"));
        } else {
            submission.setBrainSchemaVersion("missing-payload");
            submission.setBrainPayload("{}");
        }

        submission.setStatus(validation.isAccepted()
                ? ModelSubmissionStatus.VALIDATED
                : ModelSubmissionStatus.REJECTED);
        return submission;
    }

    private String requestFingerprint(ModelSubmissionPayloadDTO payload) {
        try {
            byte[] serializedPayload = jsonMapper.writeValueAsString(payload)
                    .getBytes(StandardCharsets.UTF_8);
            return java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(serializedPayload));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        } catch (Exception ex) {
            throw new IllegalArgumentException("Model submission payload could not be fingerprinted", ex);
        }
    }

    private String submissionTrainingSessionKey(ModelSubmissionPayloadDTO payload) {
        if (payload == null || !hasText(payload.getTrainingSessionId())) {
            return null;
        }
        return truncate(payload.getTrainingSessionId().trim(), MAX_TRAINING_SESSION_ID_LENGTH);
    }

    private void validateMatchBinding(
            ModelSubmissionPayloadDTO payload,
            AppUser user,
            ModelSubmissionValidationResponseDTO validation) {
        if (payload == null || "ERROR".equals(validation.getStatus())) {
            return;
        }

        UUID matchId = payload.getMatchId();
        if (matchId != null) {
            try {
                matchService.requireActiveMatchForUser(user.getId(), matchId);
            } catch (AuthException ex) {
                rejectValidation(validation, "matchId is not active for this user");
                return;
            }
        }

        if (!hasText(payload.getTrainingSessionId())) {
            return;
        }

        UUID trainingSessionId;
        try {
            trainingSessionId = UUID.fromString(payload.getTrainingSessionId().trim());
        } catch (IllegalArgumentException ex) {
            return;
        }

        Optional<TrainingSession> session = trainingSessionRepository.findByIdAndUserId(trainingSessionId, user.getId());
        if (session.isEmpty()) {
            return;
        }

        UUID sessionMatchId = session.get().getMatchId();
        if (sessionMatchId != null && matchId == null) {
            rejectValidation(validation, "matchId is required for match training sessions");
            return;
        }
        if (matchId != null && !matchId.equals(sessionMatchId)) {
            rejectValidation(validation, "trainingSessionId is not assigned to this match");
        }
    }

    private Integer validateOwnedTrainingSession(
            ModelSubmissionPayloadDTO payload,
            AppUser user,
            ModelSubmissionValidationResponseDTO validation) {
        if (payload == null || !hasText(payload.getTrainingSessionId())) {
            return null;
        }

        UUID trainingSessionId;
        try {
            trainingSessionId = UUID.fromString(payload.getTrainingSessionId().trim());
        } catch (IllegalArgumentException ex) {
            rejectValidation(validation, "trainingSessionId must be a server-issued UUID");
            return null;
        }

        Optional<TrainingSession> session = trainingSessionRepository.findByIdAndUserIdForSubmission(
                trainingSessionId,
                user.getId());
        if (session.isEmpty()) {
            if (!"ERROR".equals(validation.getStatus())) {
                rejectValidation(validation, "trainingSessionId was not found for this user");
            }
            return null;
        }

        validation.setTrainingDurationTrusted(true);
        return clampToInteger(Math.max(
                0,
                Duration.between(session.get().getStartedAt(), Instant.now()).toMillis()));
    }

    private void rejectValidation(ModelSubmissionValidationResponseDTO validation, String error) {
        validation.setAccepted(false);
        validation.setStatus("REJECTED");
        validation.setMessage("Bot brain failed validation");

        List<String> errors = validation.getErrors() == null
                ? new ArrayList<>()
                : new ArrayList<>(validation.getErrors());
        if (!errors.contains(error)) {
            errors.add(error);
        }
        validation.setErrors(errors);
    }

    private void addWarning(ModelSubmissionValidationResponseDTO validation, String warning) {
        List<String> warnings = validation.getWarnings() == null
                ? new ArrayList<>()
                : new ArrayList<>(validation.getWarnings());
        if (!warnings.contains(warning)) {
            warnings.add(warning);
        }
        validation.setWarnings(warnings);
    }

    private Integer clampToInteger(long value) {
        return value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
    }

    private ValidationResult toValidationResult(
            ModelSubmission submission,
            ModelSubmissionValidationResponseDTO validation) {
        ValidationResult result = new ValidationResult();
        result.setModelSubmission(submission);
        result.setStatus(toValidationStatus(validation));
        result.setValidatorVersion(validation.getValidatorVersion());
        result.setRejectionCode(toRejectionCode(validation));

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("message", validation.getMessage());
        details.put("trainingDurationTrusted", validation.isTrainingDurationTrusted());
        details.put("errors", validation.getErrors());
        details.put("warnings", validation.getWarnings());
        result.setDetails(toJson(details, "{}"));
        return result;
    }

    private ValidationStatus toValidationStatus(ModelSubmissionValidationResponseDTO validation) {
        if ("ERROR".equals(validation.getStatus())) {
            return ValidationStatus.ERROR;
        }

        return validation.isAccepted() ? ValidationStatus.ACCEPTED : ValidationStatus.REJECTED;
    }

    private String toRejectionCode(ModelSubmissionValidationResponseDTO validation) {
        if (validation.isAccepted()) {
            return null;
        }

        if ("ERROR".equals(validation.getStatus())) {
            return "MODEL_SUBMISSION_VALIDATION_ERROR";
        }

        return "MODEL_SUBMISSION_CONTRACT_FAILED";
    }

    private String toJson(Object value, String fallback) {
        if (value == null) {
            return fallback;
        }

        try {
            return jsonMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return fallback;
        }
    }

    private String cleanText(String value, String fallback, int maxLength) {
        String cleaned = hasText(value) ? value : fallback;
        return truncate(cleaned, maxLength);
    }

    private String cleanNullableText(String value, int maxLength) {
        if (!hasText(value)) {
            return null;
        }

        return truncate(value, maxLength);
    }

    private String truncate(String value, int maxLength) {
        if (value.length() <= maxLength) {
            return value;
        }

        return value.substring(0, maxLength);
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private Integer cleanNonNegative(Integer value) {
        if (value == null || value < 0) {
            return null;
        }

        return value;
    }
}
