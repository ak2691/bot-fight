package com.example.botfight.security;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Optionally expires every HTTP session after an absolute age, even when it is
 * being kept active by requests. The normal servlet session timeout remains
 * the inactivity limit.
 */
public class SessionAbsoluteMaxAgeFilter extends OncePerRequestFilter {

    private final Clock clock;
    private final Duration maxAge;

    public SessionAbsoluteMaxAgeFilter(Clock clock, Duration maxAge) {
        this.clock = clock;
        this.maxAge = maxAge;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        if (session != null && !maxAge.isZero() && !maxAge.isNegative() && isExpired(session)) {
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
