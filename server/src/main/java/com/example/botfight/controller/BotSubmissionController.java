package com.example.botfight.controller;

import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import com.example.botfight.DTO.submission.BotSubmissionValidationResponseDTO;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.submission.BotSubmissionService;
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
@RequestMapping("/api/bot-submissions")
public class BotSubmissionController {

    private static final Logger log = LoggerFactory.getLogger(BotSubmissionController.class);
    private final BotSubmissionService botSubmissionService;

    public BotSubmissionController(BotSubmissionService botSubmissionService) {
        this.botSubmissionService = botSubmissionService;
    }

    @PostMapping
    public ResponseEntity<BotSubmissionValidationResponseDTO> submitBot(
            @RequestBody BotSubmissionPayloadDTO payload,
            Authentication authentication) {
        BotSubmissionValidationResponseDTO validation = botSubmissionService.submit(payload, authentication);

        log.info(
                "Match bot brain submission handled. accepted={}, matchId={}, brainSchemaVersion={}",
                validation.isAccepted(),
                payload == null ? null : payload.getMatchId(),
                payload == null || payload.getBrain() == null ? null : payload.getBrain().path("version").asText(null));

        return ResponseEntity
                .status(validation.isAccepted() ? HttpStatus.OK : HttpStatus.BAD_REQUEST)
                .body(validation);
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<Map<String, String>> handleRateLimit(RateLimitExceededException ex) {
        long retryAfterSeconds = Math.max(1, ex.getRetryAfter().toSeconds());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds))
                .body(Map.of("message", RateLimitExceededException.GENERIC_MESSAGE));
    }
}
