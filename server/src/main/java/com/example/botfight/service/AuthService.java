package com.example.botfight.service;

import com.example.botfight.DTO.AuthRequestDTO;
import com.example.botfight.DTO.AuthUserDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.security.AuthenticatedUserDetails;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AuthUserDTO register(AuthRequestDTO request, HttpServletRequest httpRequest) {
        String email = clean(request == null ? null : request.getEmail());
        String normalizedEmail = normalizeEmail(email);
        String username = UsernamePolicy.clean(request == null ? null : request.getUsername());
        String password = request == null ? null : request.getPassword();

        validateEmail(email);
        UsernamePolicy.validate(username);
        PasswordPolicy.validateForRegistration(password);
        if (userRepository.existsByNormalizedEmail(normalizedEmail)) {
            throw new AuthException("email is already registered");
        }
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new AuthException("username is already taken");
        }

        AppUser user = new AppUser();
        user.setEmail(email);
        user.setNormalizedEmail(normalizedEmail);
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(password));
        AppUser savedUser = userRepository.save(user);

        authenticateSession(savedUser, httpRequest);
        return toAuthUser(savedUser);
    }

    @Transactional(readOnly = true)
    public AuthUserDTO login(AuthRequestDTO request, HttpServletRequest httpRequest) {
        String email = clean(request == null ? null : request.getEmail());
        String password = request == null ? null : request.getPassword();
        validateEmail(email);
        requirePasswordForLogin(password);

        AppUser user = userRepository.findByNormalizedEmail(normalizeEmail(email))
                .orElseThrow(() -> new AuthException("invalid email or password"));
        if (user.getPasswordHash() == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new AuthException("invalid email or password");
        }
        if (!UsernamePolicy.isValid(user.getUsername())) {
            throw new AuthException("username setup is required; continue with Google to choose one");
        }

        authenticateSession(user, httpRequest);
        return toAuthUser(user);
    }

    @Transactional(readOnly = true)
    public AuthUserDTO currentUser(Authentication authentication) {
        if (authentication == null
                || !authentication.isAuthenticated()
                || !(authentication.getPrincipal() instanceof AuthenticatedUserDetails principal)) {
            return AuthUserDTO.guest();
        }

        return userRepository.findById(principal.getId())
                .filter(user -> UsernamePolicy.isValid(user.getUsername()))
                .map(this::toAuthUser)
                .orElseGet(AuthUserDTO::guest);
    }

    public AuthUserDTO toAuthUser(AppUser user) {
        AuthUserDTO response = new AuthUserDTO();
        response.setAuthenticated(true);
        response.setId(user.getId());
        response.setEmail(user.getEmail());
        response.setUsername(user.getUsername());
        return response;
    }

    public void authenticateSession(AppUser user, HttpServletRequest request) {
        AuthenticatedUserDetails principal = new AuthenticatedUserDetails(user);
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new UsernamePasswordAuthenticationToken(
                principal,
                null,
                principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
        var session = request.getSession(true);
        request.changeSessionId();
        session.setAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,
                context);
    }

    private void validateEmail(String email) {
        if (email == null || !EMAIL_PATTERN.matcher(email).matches()) {
            throw new AuthException("email must be a valid email address");
        }
    }

    private void requirePasswordForLogin(String password) {
        PasswordPolicy.requireForLogin(password);
    }

    private String normalizeEmail(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    private String clean(String value) {
        return value == null ? null : value.trim();
    }
}
