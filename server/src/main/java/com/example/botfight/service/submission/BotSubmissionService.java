package com.example.botfight.service.submission;

import java.util.HexFormat;

import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.model.MatchSubmissionResult;
import com.example.botfight.service.matchmaking.MatchmakingEventsReady;
import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.submission.BotSubmissionValidationResponseDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.domain.submission.BotSubmissionStatus;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class BotSubmissionService {

    private static final int MAX_VERSION_LENGTH = 50;
    private static final int MAX_CLIENT_BUILD_VERSION_LENGTH = 100;
    private static final int MAX_SELECTED_LOADOUT_LENGTH = 40;
    private static final String VALIDATOR_VERSION = "bot-submission-v1";

    private final BotSubmissionValidationService validationService;
    private final CurrentUserService currentUserService;
    private final SlidingWindowRateLimiter<UUID> rateLimiter;
    private final MatchService matchService;
    private final ApplicationEventPublisher eventPublisher;
    private final JsonMapper jsonMapper;

    public BotSubmissionService(
            BotSubmissionValidationService validationService,
            CurrentUserService currentUserService,
            @Qualifier("botSubmissionRateLimiter") SlidingWindowRateLimiter<UUID> rateLimiter,
            MatchService matchService,
            ApplicationEventPublisher eventPublisher,
            JsonMapper jsonMapper) {
        this.validationService = validationService;
        this.currentUserService = currentUserService;
        this.rateLimiter = rateLimiter;
        this.matchService = matchService;
        this.eventPublisher = eventPublisher;
        this.jsonMapper = jsonMapper;
    }

    @Transactional
    public BotSubmissionValidationResponseDTO submit(BotSubmissionPayloadDTO payload, Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        if (payload == null || payload.getMatchId() == null) {
            return rejectedSubmission("bot submissions require an active match");
        }
        if (!matchService.isCurrentMatchSubmission(
                user.getId(),
                payload.getMatchId(),
                payload.getRoundNumber(),
                payload.getPhase())) {
            return rejectedSubmission(
                    "bot submission is stale because the match is no longer in this round's building phase");
        }

        rateLimiter.requireAllowed(user.getId());
        String requestFingerprint = requestFingerprint(payload);
        var structureErrors = validationService.brainStructureErrors(payload.getBrain());
        if (!structureErrors.isEmpty()) return rejectedSubmission(String.join("; ", structureErrors));
        String kit = matchService.kitForSubmission(user.getId(), payload.getMatchId());
        if (kit == null) return rejectedSubmission("the authoritative kit is unavailable");
        if (payload.getBrain() != null && payload.getBrain().isObject()) {
            // Check hostile structure first; then worker rules always see the server-owned kit.
            var brain = (ObjectNode) payload.getBrain().deepCopy();
            var kitNode = new com.example.botfight.service.match.MatchLoadoutService(jsonMapper).encodedLoadoutNode(kit);
            brain.set("loadout", kitNode);
            payload.setBrain(brain);
        }
        BotSubmissionValidationResponseDTO validation = validateSafely(payload);
        validation.setBuildingDurationTrusted(validation.isAccepted());
        if (validation.isAccepted()) payload.setSelectedLoadout(kit);

        BotSubmission submission = toSubmission(
                payload,
                validation,
                user, requestFingerprint);

        if (!validation.isAccepted()) return validation;
        MatchSubmissionResult result = matchService.acceptMatchSubmission(
                user.getId(),
                payload.getMatchId(),
                payload.getRoundNumber(),
                payload.getPhase(),
                submission);
        if (!result.accepted()) {
            rejectValidation(validation, result.message());
            return validation;
        }
        if (!result.duplicate()) {
            eventPublisher.publishEvent(new MatchmakingEventsReady(result.events()));
        }
        return validation;
    }

    private BotSubmissionValidationResponseDTO rejectedSubmission(String message) {
        BotSubmissionValidationResponseDTO response = new BotSubmissionValidationResponseDTO();
        response.setAccepted(false);
        response.setStatus("REJECTED");
        response.setMessage("Bot brain failed validation");
        response.setValidatorVersion(VALIDATOR_VERSION);
        response.setBuildingDurationTrusted(false);
        response.setErrors(List.of(message));
        response.setWarnings(List.of());
        return response;
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
            response.setBuildingDurationTrusted(false);
            response.setErrors(List.of("validator error: " + ex.getClass().getSimpleName()));
            response.setWarnings(List.of());
            return response;
        }
    }

    private BotSubmission toSubmission(
            BotSubmissionPayloadDTO payload,
            BotSubmissionValidationResponseDTO validation,
            AppUser user,
            String requestFingerprint) {
        BotSubmission submission = new BotSubmission();
        submission.setUser(user);
        submission.setRequestFingerprint(requestFingerprint);

        if (payload != null) {
            submission.setMatchId(payload.getMatchId());
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
            // Validated against the brain's declared variables before this point.
            submission.setVariableResets(payload.getVariableResets() == null
                    ? List.of()
                    : payload.getVariableResets().stream().distinct().toList());
            submission.setTimeoutFallback(payload.getTimeoutFallback());
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
            Object fingerprintPayload = payload;
            if (payload != null && payload.getMatchId() != null) {
                // Match idempotency is owned by the round/phase/user key, not
                // by any client-provided session token.
                ObjectNode canonical = jsonMapper.createObjectNode();
                canonical.put("matchId", payload.getMatchId().toString());
                if (payload.getRoundNumber() != null) {
                    canonical.put("roundNumber", payload.getRoundNumber());
                }
                if (payload.getPhase() != null) canonical.put("phase", payload.getPhase());
                if (payload.getSelectedLoadout() != null) {
                    canonical.put("selectedLoadout", payload.getSelectedLoadout());
                }
                if (payload.getClientBuildVersion() != null) {
                    canonical.put("clientBuildVersion", payload.getClientBuildVersion());
                }
                if (payload.getBrain() != null) canonical.set("brain", payload.getBrain());
                if (payload.getVariableResets() != null && !payload.getVariableResets().isEmpty()) {
                    var resets = canonical.putArray("variableResets");
                    payload.getVariableResets().stream().distinct().sorted().forEach(resets::add);
                }
                if (payload.getTimeoutFallback() != null) {
                    canonical.put("timeoutFallback", payload.getTimeoutFallback());
                }
                fingerprintPayload = canonical;
            }
            byte[] serializedPayload = jsonMapper.writeValueAsString(fingerprintPayload)
                    .getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(serializedPayload));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        } catch (Exception ex) {
            throw new IllegalArgumentException("Bot submission payload could not be fingerprinted", ex);
        }
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

}
