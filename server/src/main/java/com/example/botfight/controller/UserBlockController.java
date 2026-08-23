package com.example.botfight.controller;

import com.example.botfight.DTO.BlockStatusDTO;
import com.example.botfight.service.block.UserBlockService;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/blocks")
public class UserBlockController {

    private final UserBlockService userBlockService;
    private final CurrentUserService currentUserService;
    private final TokenBucketRateLimiter<String> authenticatedGetRateLimiter;

    public UserBlockController(
            UserBlockService userBlockService,
            CurrentUserService currentUserService,
            @Qualifier("authenticatedGetRateLimiter")
            TokenBucketRateLimiter<String> authenticatedGetRateLimiter) {
        this.userBlockService = userBlockService;
        this.currentUserService = currentUserService;
        this.authenticatedGetRateLimiter = authenticatedGetRateLimiter;
    }

    @GetMapping("/status/{username}")
    public BlockStatusDTO status(
            Authentication authentication,
            @PathVariable String username) {
        UUID userId = currentUserService.requireCurrentUserId(authentication);
        authenticatedGetRateLimiter.requireAllowed("block-status:" + userId);
        return userBlockService.status(authentication, username);
    }

    @PostMapping("/{username}")
    public BlockStatusDTO block(
            Authentication authentication,
            @PathVariable String username) {
        return userBlockService.block(authentication, username);
    }

    @DeleteMapping("/{username}")
    public BlockStatusDTO unblock(
            Authentication authentication,
            @PathVariable String username) {
        return userBlockService.unblock(authentication, username);
    }
}
