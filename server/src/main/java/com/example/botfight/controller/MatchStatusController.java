package com.example.botfight.controller;

import com.example.botfight.DTO.match.ActiveMatchStatusDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.match.MatchService;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/matches")
public class MatchStatusController {

    private final CurrentUserService currentUserService;
    private final MatchService matchService;

    public MatchStatusController(
            CurrentUserService currentUserService,
            MatchService matchService) {
        this.currentUserService = currentUserService;
        this.matchService = matchService;
    }

    @GetMapping("/active")
    public ActiveMatchStatusDTO activeMatch(Authentication authentication) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        return matchService.activeMatchStatus(userId);
    }
}
