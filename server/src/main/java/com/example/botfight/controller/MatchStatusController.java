package com.example.botfight.controller;

import com.example.botfight.DTO.ActiveMatchStatusDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.service.CurrentUserService;
import com.example.botfight.service.MatchService;
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
        AppUser user = currentUserService.requireCurrentUser(authentication);
        return matchService.activeMatchStatus(user.getId());
    }
}
