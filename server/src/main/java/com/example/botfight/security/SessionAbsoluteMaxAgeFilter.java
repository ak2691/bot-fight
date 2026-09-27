package com.example.botfight.security;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Expires every HTTP session after a positive absolute age, even when it is
 * being kept active by requests. The normal servlet session timeout remains
 * the inactivity limit.
 */
public class SessionAbsoluteMaxAgeFilter extends OncePerRequestFilter {

    private final Clock clock;
    private final Duration maxAge;

    public SessionAbsoluteMaxAgeFilter(Clock clock, Duration maxAge) {
        this.clock = Objects.requireNonNull(clock, "clock");
        if (maxAge == null || maxAge.isZero() || maxAge.isNegative()) {
            throw new IllegalArgumentException("Session max age must be positive");
        }
        this.maxAge = maxAge;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        if (session != null && isExpired(session)) {
            session.invalidate();
            SecurityContextHolder.clearContext();
        }
        filterChain.doFilter(request, response);
    }

    private boolean isExpired(HttpSession session) {
        Instant createdAt = Instant.ofEpochMilli(session.getCreationTime());
        return !clock.instant().isBefore(createdAt.plus(maxAge));
    }
}
