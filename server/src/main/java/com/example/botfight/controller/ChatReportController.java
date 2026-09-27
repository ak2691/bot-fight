package com.example.botfight.controller;

import com.example.botfight.DTO.chatmoderation.ChatReportAcknowledgementDTO;
import com.example.botfight.DTO.chatmoderation.ChatReportRequestDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.chatmoderation.ChatReportService;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Accepts a report target only by its server-issued message UUID. */
@RestController
@RequestMapping("/api/chat-reports")
public class ChatReportController {

    private final CurrentUserService currentUserService;
    private final ChatReportService reportService;

    public ChatReportController(CurrentUserService currentUserService, ChatReportService reportService) {
        this.currentUserService = currentUserService;
        this.reportService = reportService;
    }

    @PostMapping("/{messageId}")
    public ResponseEntity<ChatReportAcknowledgementDTO> report(
            @PathVariable UUID messageId,
            @RequestBody ChatReportRequestDTO request,
            org.springframework.security.core.Authentication authentication) {
        var reporter = currentUserService.requireRegisteredUser(authentication);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(reportService.report(
                reporter.getId(),
                messageId,
                request == null ? null : request.reason(),
                request == null ? null : request.note()));
    }

    @ExceptionHandler(com.example.botfight.service.chatmoderation.ChatReportValidationException.class)
    public ResponseEntity<Map<String, String>> handleValidation() {
        return ResponseEntity.badRequest().body(Map.of("message", "Report request was not accepted."));
    }
}
