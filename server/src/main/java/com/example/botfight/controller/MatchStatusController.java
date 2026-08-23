package com.example.botfight.controller;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.MatchService;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/matches")
public class MatchStatusController {

    private final CurrentUserService currentUserService;
    private final MatchService matchService;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;

    public MatchStatusController(
            CurrentUserService currentUserService,
            MatchService matchService,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this.currentUserService = currentUserService;
        this.matchService = matchService;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
    }

    @GetMapping("/active")
    public ActiveMatchStatusDTO activeMatch(Authentication authentication) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        authenticatedGetRateLimiter.requireAllowed("active-match:" + userId);
        return matchService.activeMatchStatus(userId);
    }
}
