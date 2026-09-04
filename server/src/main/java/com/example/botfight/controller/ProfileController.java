package com.example.botfight.controller;

import com.example.botfight.DTO.profile.AboutMeRequestDTO;
import com.example.botfight.DTO.profile.ProfileDTO;
import com.example.botfight.DTO.match.MatchHistoryPageDTO;
import com.example.botfight.DTO.profile.ProfileSearchPageDTO;
import com.example.botfight.DTO.profile.SolvedPuzzlePageDTO;
import com.example.botfight.DTO.auth.UsernameRequestDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.profile.ProfileService;
import java.time.Instant;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
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

    @GetMapping("/search")
    public ProfileSearchPageDTO searchProfiles(
            Authentication authentication,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "") String query) {
        return profileService.searchProfiles(authentication, page, query);
    }

    @GetMapping("/users/{username}")
    public ProfileDTO publicProfile(
            Authentication authentication,
            @PathVariable String username) {
        return profileService.publicProfile(authentication, username);
    }

    @GetMapping("/users/{username}/matches")
    public MatchHistoryPageDTO publicMatchHistory(
            Authentication authentication,
            @PathVariable String username,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "") String query,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to) {
        return profileService.publicMatchHistory(authentication, username, page, query, from, to);
    }

    @GetMapping("/users/{username}/puzzles")
    public SolvedPuzzlePageDTO publicSolvedPuzzles(
            Authentication authentication,
            @PathVariable String username,
            @RequestParam(defaultValue = "0") int page) {
        return profileService.publicSolvedPuzzles(authentication, username, page);
    }

    @PutMapping("/username")
    public ProfileDTO updateUsername(
            Authentication authentication,
            @RequestBody UsernameRequestDTO request) {
        return profileService.updateUsername(authentication, request);
    }

    @PutMapping("/about-me")
    public ProfileDTO updateAboutMe(
            Authentication authentication,
            @RequestBody AboutMeRequestDTO request) {
        return profileService.updateAboutMe(authentication, request);
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

    @GetMapping("/puzzles")
    public SolvedPuzzlePageDTO solvedPuzzles(
            Authentication authentication,
            @RequestParam(defaultValue = "0") int page) {
        return profileService.solvedPuzzles(authentication, page);
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(AuthException.class)
    public ResponseEntity<Map<String, String>> handleAuthException(AuthException exception) {
        return ResponseEntity.badRequest().body(Map.of("message", exception.getMessage()));
    }
}
