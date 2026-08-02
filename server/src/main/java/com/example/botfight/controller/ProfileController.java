package com.example.botfight.controller;

import com.example.botfight.DTO.ProfileDTO;
import com.example.botfight.DTO.MatchHistoryPageDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.service.AuthException;
import com.example.botfight.service.ProfileService;
import java.time.Instant;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;
import java.util.Map;

@RestController
@RequestMapping("/api/profile")
public class ProfileController {

    private final ProfileService profileService;

    public ProfileController(ProfileService profileService) {
        this.profileService = profileService;
    }

    @GetMapping
    public ProfileDTO currentProfile(Authentication authentication) {
        return profileService.currentProfile(authentication);
    }

    @PutMapping("/username")
    public ProfileDTO updateUsername(
            Authentication authentication,
            @RequestBody UsernameRequestDTO request) {
        return profileService.updateUsername(authentication, request);
    }

    @GetMapping("/matches")
    public MatchHistoryPageDTO matchHistory(
            Authentication authentication,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "") String query,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to) {
        return profileService.matchHistory(authentication, page, query, from, to);
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(AuthException.class)
    public ResponseEntity<Map<String, String>> handleAuthException(AuthException exception) {
        return ResponseEntity.badRequest().body(Map.of("message", exception.getMessage()));
    }
}
