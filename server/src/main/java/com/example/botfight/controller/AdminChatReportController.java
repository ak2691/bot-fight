package com.example.botfight.controller;

import com.example.botfight.DTO.chatmoderation.ChatModerationAuditDTO;
import com.example.botfight.DTO.chatmoderation.ChatReportDetailDTO;
import com.example.botfight.DTO.chatmoderation.ChatReportResolutionRequestDTO;
import com.example.botfight.DTO.chatmoderation.ChatReportSummaryDTO;
import com.example.botfight.domain.chatmoderation.ChatReportStatus;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.chatmoderation.ChatReportAdminService;
import com.example.botfight.service.chatmoderation.ChatReportConflictException;
import com.example.botfight.service.chatmoderation.ChatReportNotFoundException;
import com.example.botfight.service.chatmoderation.ChatReportValidationException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Admin-only list, evidence, resolution, audit, and deletion boundary. */
@RestController
@RequestMapping("/api/admin/chat-reports")
public class AdminChatReportController {

    private final CurrentUserService currentUserService;
    private final ChatReportAdminService adminService;

    public AdminChatReportController(
            CurrentUserService currentUserService,
            ChatReportAdminService adminService) {
        this.currentUserService = currentUserService;
        this.adminService = adminService;
    }

    @GetMapping
    public Page<ChatReportSummaryDTO> list(
            @RequestParam(required = false) ChatReportStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            Authentication authentication) {
        return adminService.list(currentUserService.requireCurrentUserId(authentication), status, page, size);
    }

    @GetMapping("/{reportId}")
    public ChatReportDetailDTO detail(@PathVariable UUID reportId, Authentication authentication) {
        return adminService.detail(currentUserService.requireCurrentUserId(authentication), reportId);
    }

    @GetMapping("/{reportId}/audit")
    public List<ChatModerationAuditDTO> audit(@PathVariable UUID reportId, Authentication authentication) {
        return adminService.audit(currentUserService.requireCurrentUserId(authentication), reportId);
    }

    @PatchMapping("/{reportId}")
    public ChatReportDetailDTO resolve(
            @PathVariable UUID reportId,
            @RequestBody ChatReportResolutionRequestDTO request,
            Authentication authentication) {
        return adminService.resolve(
                currentUserService.requireCurrentUserId(authentication),
                reportId,
                request == null ? null : request.status(),
                request == null ? null : request.note());
    }

    @DeleteMapping("/{reportId}")
    public ResponseEntity<Void> delete(@PathVariable UUID reportId, Authentication authentication) {
        adminService.delete(currentUserService.requireCurrentUserId(authentication), reportId);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, String>> handleAccessDenied() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("message", "Admin role is required."));
    }

    @ExceptionHandler(ChatReportNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleNotFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("message", "Chat report was not found."));
    }

    @ExceptionHandler(ChatReportConflictException.class)
    public ResponseEntity<Map<String, String>> handleConflict(ChatReportConflictException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("message", exception.getMessage()));
    }

    @ExceptionHandler(ChatReportValidationException.class)
    public ResponseEntity<Map<String, String>> handleValidation() {
        return ResponseEntity.badRequest()
                .body(Map.of("message", "Report request was not accepted."));
    }
}
