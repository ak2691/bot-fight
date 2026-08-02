package com.example.botfight.service;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.BotSubmissionValidationResponseDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.BotSubmissionStatus;
import com.example.botfight.domain.TestingSession;
import com.example.botfight.domain.ValidationResult;
import com.example.botfight.domain.ValidationStatus;
import com.example.botfight.repository.BotSubmissionRepository;
import com.example.botfight.repository.TestingSessionRepository;
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
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class BotSubmissionService {

    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_TESTING_SESSION_ID_LENGTH = 100;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;
    private static final String VALIDATOR_VERSION = "bot-submission-v1";

    private final BotSubmissionValidationService validationService;
    private final BotSubmissionRepository botSubmissionRepository;
    private final TestingSessionRepository testingSessionRepository;
    private final ValidationResultRepository validationResultRepository;
    private final CurrentUserService currentUserService;
    private final BotSubmissionRateLimiter rateLimiter;
    private final MatchService matchService;
    private final ApplicationEventPublisher eventPublisher;
    private final JsonMapper jsonMapper;

    public BotSubmissionService(
            BotSubmissionValidationService validationService,
            BotSubmissionRepository botSubmissionRepository,
            TestingSessionRepository testingSessionRepository,
            ValidationResultRepository validationResultRepository,
            CurrentUserService currentUserService,
            BotSubmissionRateLimiter rateLimiter,
            MatchService matchService,
            ApplicationEventPublisher eventPublisher,
            JsonMapper jsonMapper) {
        this.validationService = validationService;
        this.botSubmissionRepository = botSubmissionRepository;
        this.testingSessionRepository = testingSessionRepository;
        this.validationResultRepository = validationResultRepository;
        this.currentUserService = currentUserService;
        this.rateLimiter = rateLimiter;
        this.matchService = matchService;
        this.eventPublisher = eventPublisher;
        this.jsonMapper = jsonMapper;
    }

    @Transactional
    public BotSubmissionValidationResponseDTO submit(BotSubmissionPayloadDTO payload, Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        String requestFingerprint = requestFingerprint(payload);
        Optional<BotSubmission> existingSubmission = findExistingSubmission(payload, user);
        if (existingSubmission.isPresent()) {
            return existingSubmissionResponse(existingSubmission.get(), requestFingerprint);
        }

        BotSubmissionValidationResponseDTO validation = validateSafely(payload);
        Integer trustedTestingDurationMs = validateOwnedTestingSession(payload, user, validation);
        validateMatchBinding(payload, user, validation);

        rateLimiter.requireAllowed(user.getId());
        rejectDuplicateFinalHash(payload, validation);
        BotSubmission submission = toSubmission(
                payload,
                validation,
                user,
                trustedTestingDurationMs,
                requestFingerprint);

        BotSubmission savedSubmission = botSubmissionRepository.save(submission);
        validationResultRepository.save(toValidationResult(savedSubmission, validation));

        if (validation.isAccepted() && savedSubmission.getMatchId() != null) {
            eventPublisher.publishEvent(new MatchmakingEventsReady(
                    matchService.markFinished(user.getId(), savedSubmission.getId())));
        }

        return validation;
    }

    private Optional<BotSubmission> findExistingSubmission(BotSubmissionPayloadDTO payload, AppUser user) {
        if (payload == null || !hasText(payload.getTestingSessionId())) {
            return Optional.empty();
        }
        return botSubmissionRepository.findByUserIdAndTestingSessionIdAndRequestFingerprintIsNotNull(
                user.getId(),
                submissionTestingSessionKey(payload));
    }

    private BotSubmissionValidationResponseDTO existingSubmissionResponse(
            BotSubmission existing,
            String requestFingerprint) {
        if (existing.getRequestFingerprint() == null
                || !existing.getRequestFingerprint().equals(requestFingerprint)) {
            throw new SubmissionConflictException(
                    "This testing session already has a different bot submission");
        }

        boolean accepted = existing.getStatus() == BotSubmissionStatus.VALIDATED;
        BotSubmissionValidationResponseDTO validation = new BotSubmissionValidationResponseDTO();
        validation.setAccepted(accepted);
        validation.setStatus(accepted ? "ACCEPTED" : "REJECTED");
        validation.setMessage(accepted ? "Bot brain passed validation" : "Bot brain failed validation");
        return validation;
    }

    private void rejectDuplicateFinalHash(
            BotSubmissionPayloadDTO payload,
            BotSubmissionValidationResponseDTO validation) {
        // Deterministic bot brains may intentionally be resubmitted unchanged across rounds.
    }

    private BotSubmissionValidationResponseDTO validateSafely(BotSubmissionPayloadDTO payload) {
        try {
            return validationService.validate(payload);
        } catch (Exception ex) {
            BotSubmissionValidationResponseDTO response = new BotSubmissionValidationResponseDTO();
            response.setAccepted(false);
            response.setStatus("ERROR");
            response.setMessage("Bot brain validation failed unexpectedly");
            response.setValidatorVersion(VALIDATOR_VERSION);
            response.setTestingDurationTrusted(false);
            response.setErrors(List.of("validator error: " + ex.getClass().getSimpleName()));
            response.setWarnings(List.of());
            return response;
        }
    }

    private BotSubmission toSubmission(
            BotSubmissionPayloadDTO payload,
            BotSubmissionValidationResponseDTO validation,
            AppUser user,
            Integer trustedTestingDurationMs,
            String requestFingerprint) {
        BotSubmission submission = new BotSubmission();
        submission.setUser(user);
        submission.setRequestFingerprint(requestFingerprint);

        if (payload != null) {
            submission.setMatchId(payload.getMatchId());
            submission.setTestingSessionId(submissionTestingSessionKey(payload));
            submission.setSelectedLoadout(cleanNullableText(
                    payload.getSelectedLoadout(), MAX_SELECTED_LOADOUT_LENGTH));
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
                ? BotSubmissionStatus.VALIDATED
                : BotSubmissionStatus.REJECTED);
        return submission;
    }

    private String requestFingerprint(BotSubmissionPayloadDTO payload) {
        try {
            byte[] serializedPayload = jsonMapper.writeValueAsString(payload)
                    .getBytes(StandardCharsets.UTF_8);
            return java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(serializedPayload));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        } catch (Exception ex) {
            throw new IllegalArgumentException("Bot submission payload could not be fingerprinted", ex);
        }
    }

    private String submissionTestingSessionKey(BotSubmissionPayloadDTO payload) {
        if (payload == null || !hasText(payload.getTestingSessionId())) {
            return null;
        }
        return truncate(payload.getTestingSessionId().trim(), MAX_TESTING_SESSION_ID_LENGTH);
    }

    private void validateMatchBinding(
            BotSubmissionPayloadDTO payload,
            AppUser user,
            BotSubmissionValidationResponseDTO validation) {
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

        if (!hasText(payload.getTestingSessionId())) {
            return;
        }

        UUID testingSessionId;
        try {
            testingSessionId = UUID.fromString(payload.getTestingSessionId().trim());
        } catch (IllegalArgumentException ex) {
            return;
        }

        Optional<TestingSession> session = testingSessionRepository.findByIdAndUserId(testingSessionId, user.getId());
        if (session.isEmpty()) {
            return;
        }

        UUID sessionMatchId = session.get().getMatchId();
        if (sessionMatchId != null && matchId == null) {
            rejectValidation(validation, "matchId is required for match testing sessions");
            return;
        }
        if (matchId != null && !matchId.equals(sessionMatchId)) {
            rejectValidation(validation, "testingSessionId is not assigned to this match");
        }
    }

    private Integer validateOwnedTestingSession(
            BotSubmissionPayloadDTO payload,
            AppUser user,
            BotSubmissionValidationResponseDTO validation) {
        if (payload == null || !hasText(payload.getTestingSessionId())) {
            return null;
        }

        UUID testingSessionId;
        try {
            testingSessionId = UUID.fromString(payload.getTestingSessionId().trim());
        } catch (IllegalArgumentException ex) {
            rejectValidation(validation, "testingSessionId must be a server-issued UUID");
            return null;
        }

        Optional<TestingSession> session = testingSessionRepository.findByIdAndUserIdForSubmission(
                testingSessionId,
                user.getId());
        if (session.isEmpty()) {
            if (!"ERROR".equals(validation.getStatus())) {
                rejectValidation(validation, "testingSessionId was not found for this user");
            }
            return null;
        }

        validation.setTestingDurationTrusted(true);
        return clampToInteger(Math.max(
                0,
                Duration.between(session.get().getStartedAt(), Instant.now()).toMillis()));
    }

    private void rejectValidation(BotSubmissionValidationResponseDTO validation, String error) {
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

    private void addWarning(BotSubmissionValidationResponseDTO validation, String warning) {
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
            BotSubmission submission,
            BotSubmissionValidationResponseDTO validation) {
        ValidationResult result = new ValidationResult();
        result.setBotSubmission(submission);
        result.setStatus(toValidationStatus(validation));
        result.setValidatorVersion(validation.getValidatorVersion());
        result.setRejectionCode(toRejectionCode(validation));

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("message", validation.getMessage());
        details.put("testingDurationTrusted", validation.isTestingDurationTrusted());
        details.put("errors", validation.getErrors());
        details.put("warnings", validation.getWarnings());
        result.setDetails(toJson(details, "{}"));
        return result;
    }

    private ValidationStatus toValidationStatus(BotSubmissionValidationResponseDTO validation) {
        if ("ERROR".equals(validation.getStatus())) {
            return ValidationStatus.ERROR;
        }

        return validation.isAccepted() ? ValidationStatus.ACCEPTED : ValidationStatus.REJECTED;
    }

    private String toRejectionCode(BotSubmissionValidationResponseDTO validation) {
        if (validation.isAccepted()) {
            return null;
        }

        if ("ERROR".equals(validation.getStatus())) {
            return "BOT_SUBMISSION_VALIDATION_ERROR";
        }

        return "BOT_SUBMISSION_CONTRACT_FAILED";
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
