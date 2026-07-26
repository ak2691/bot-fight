package com.example.botfight.controller;

import com.example.botfight.DTO.TrainingSessionResponseDTO;
import com.example.botfight.service.TrainingSessionNotFoundException;
import com.example.botfight.service.TrainingSessionService;
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
@RequestMapping("/api/training-sessions")
public class TrainingSessionController {

    private final TrainingSessionService trainingSessionService;

    public TrainingSessionController(TrainingSessionService trainingSessionService) {
        this.trainingSessionService = trainingSessionService;
    }

    @PostMapping
    public ResponseEntity<TrainingSessionResponseDTO> createSession(
            @RequestParam(required = false) UUID matchId,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED).body(trainingSessionService.createSession(authentication, matchId));
    }

    @GetMapping("/{trainingSessionId}/duration")
    public ResponseEntity<TrainingSessionResponseDTO> getTrustedDuration(
            @PathVariable UUID trainingSessionId,
            Authentication authentication) {
        return ResponseEntity.ok(trainingSessionService.getDuration(trainingSessionId, authentication));
    }

    @ExceptionHandler(TrainingSessionNotFoundException.class)
    public ResponseEntity<String> handleNotFound(TrainingSessionNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ex.getMessage());
    }
}
