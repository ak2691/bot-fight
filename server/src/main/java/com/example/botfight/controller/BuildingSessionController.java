package com.example.botfight.controller;

import com.example.botfight.DTO.BuildingSessionResponseDTO;
import com.example.botfight.service.BuildingSessionNotFoundException;
import com.example.botfight.service.BuildingSessionService;
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
@RequestMapping("/api/building-sessions")
public class BuildingSessionController {

    private final BuildingSessionService buildingSessionService;

    public BuildingSessionController(BuildingSessionService buildingSessionService) {
        this.buildingSessionService = buildingSessionService;
    }

    @PostMapping
    public ResponseEntity<BuildingSessionResponseDTO> createSession(
            @RequestParam(required = false) UUID matchId,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED).body(buildingSessionService.createSession(authentication, matchId));
    }

    @GetMapping("/{buildingSessionId}/duration")
    public ResponseEntity<BuildingSessionResponseDTO> getTrustedDuration(
            @PathVariable UUID buildingSessionId,
            Authentication authentication) {
        return ResponseEntity.ok(buildingSessionService.getDuration(buildingSessionId, authentication));
    }

    @ExceptionHandler(BuildingSessionNotFoundException.class)
    public ResponseEntity<String> handleNotFound(BuildingSessionNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ex.getMessage());
    }
}
