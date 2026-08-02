package com.example.botfight.controller;

import com.example.botfight.DTO.TestingSessionResponseDTO;
import com.example.botfight.service.TestingSessionNotFoundException;
import com.example.botfight.service.TestingSessionService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/testing-sessions")
public class TestingSessionController {

    private final TestingSessionService testingSessionService;

    public TestingSessionController(TestingSessionService testingSessionService) {
        this.testingSessionService = testingSessionService;
    }

    @PostMapping
    public ResponseEntity<TestingSessionResponseDTO> createSession(
            @RequestParam(required = false) UUID matchId,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED).body(testingSessionService.createSession(authentication, matchId));
    }

    @GetMapping("/{testingSessionId}/duration")
    public ResponseEntity<TestingSessionResponseDTO> getTrustedDuration(
            @PathVariable UUID testingSessionId,
            Authentication authentication) {
        return ResponseEntity.ok(testingSessionService.getDuration(testingSessionId, authentication));
    }

    @ExceptionHandler(TestingSessionNotFoundException.class)
    public ResponseEntity<String> handleNotFound(TestingSessionNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ex.getMessage());
    }
}
