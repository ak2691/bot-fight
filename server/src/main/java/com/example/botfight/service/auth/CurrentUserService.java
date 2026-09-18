package com.example.botfight.service.auth;

import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.security.AuthenticatedUserDetails;
import java.time.Instant;
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

    /** Returns the identity established by Spring Security after guest revalidation. */
    public UUID requireCurrentUserId(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)
                || principal.getId() == null
                || !principal.isGuestActive(Instant.now())) {
            throw new AuthException("authentication is required");
        }
        if (principal.isGuest()) {
            Instant now = Instant.now();
            AppUser guest = userRepository.findById(principal.getId())
                    .filter(AppUser::isGuest)
                    .filter(user -> user.isGuestActive(now))
                    .orElseThrow(() -> new AuthException("guest session has expired; start a new guest session"));
        }
        return principal.getId();
    }

    @Transactional(readOnly = true)
    public AppUser requireCurrentUser(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)) {
            throw new AuthException("authentication is required");
        }

        UUID userId = principal.getId();
        if (!principal.isGuestActive(Instant.now())) {
            throw new AuthException("guest session has expired; start a new guest session");
        }
        AppUser user = userRepository.findById(userId)
                .orElseThrow(() -> new AuthException("authenticated user was not found"));
        if (!UsernamePolicy.isValid(user.getUsername())) {
            throw new AuthException("username setup is required before using this account");
        }
        return user;
    }

    public AppUser requireRegisteredUser(Authentication authentication) {
        AppUser user = requireCurrentUser(authentication);
        if (user.isGuest()) {
            throw new AuthException("create an account to use this feature");
        }
        return user;
    }

    public boolean isGuest(Authentication authentication) {
        return authentication != null
                && authentication.isAuthenticated()
                && authentication.getPrincipal() instanceof AuthenticatedUserDetails principal
                && principal.isGuest();
    }
}
