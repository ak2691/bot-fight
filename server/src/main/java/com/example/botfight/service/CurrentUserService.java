package com.example.botfight.service;

import com.example.botfight.domain.AppUser;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.security.AuthenticatedUserDetails;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CurrentUserService {

    private final UserRepository userRepository;

    public CurrentUserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public AppUser requireCurrentUser(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)) {
            throw new AuthException("authentication is required");
        }

        UUID userId = principal.getId();
        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> new AuthException("authenticated user was not found"));
        if (!UsernamePolicy.isValid(user.getUsername())) {
            throw new AuthException("username setup is required before using this account");
        }
        return user;
    }
}
