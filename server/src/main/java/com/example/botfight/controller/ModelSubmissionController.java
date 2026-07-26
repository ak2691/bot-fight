package com.example.botfight.controller;

import com.example.botfight.DTO.ModelSubmissionPayloadDTO;
import com.example.botfight.DTO.ModelSubmissionValidationResponseDTO;
import com.example.botfight.service.ModelSubmissionService;
import com.example.botfight.service.RateLimitExceededException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/model-submissions")
public class ModelSubmissionController {

    private static final Logger log = LoggerFactory.getLogger(ModelSubmissionController.class);
    private final ModelSubmissionService modelSubmissionService;

    public ModelSubmissionController(ModelSubmissionService modelSubmissionService) {
        this.modelSubmissionService = modelSubmissionService;
    }

    @PostMapping
    public ResponseEntity<ModelSubmissionValidationResponseDTO> submitModel(
            @RequestBody ModelSubmissionPayloadDTO payload,
            Authentication authentication) {
        ModelSubmissionValidationResponseDTO validation = modelSubmissionService.submit(payload, authentication);

        log.info(
                "Bot brain submission persisted. id={}, accepted={}, session={}, brainSchemaVersion={}",
                validation.getModelSubmissionId(),
                validation.isAccepted(),
                payload == null ? null : payload.getTrainingSessionId(),
                payload == null || payload.getBrain() == null ? null : payload.getBrain().path("version").asText(null));

        return ResponseEntity
                .status(validation.isAccepted() ? HttpStatus.ACCEPTED : HttpStatus.BAD_REQUEST)
                .body(validation);
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<Map<String, String>> handleRateLimit(RateLimitExceededException ex) {
        long retryAfterSeconds = Math.max(1, ex.getRetryAfter().toSeconds());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds))
                .body(Map.of("message", ex.getMessage()));
    }
}
