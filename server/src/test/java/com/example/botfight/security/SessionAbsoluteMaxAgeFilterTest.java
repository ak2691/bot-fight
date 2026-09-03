package com.example.botfight.security;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;

class SessionAbsoluteMaxAgeFilterTest {

    private static final Instant CREATED_AT = Instant.parse("2026-08-01T12:00:00Z");

    @Test
    void expiresSessionAtAbsoluteAgeEvenWhenItIsActive() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        HttpSession session = mock(HttpSession.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getSession(false)).thenReturn(session);
        when(session.getCreationTime()).thenReturn(CREATED_AT.toEpochMilli());

        SessionAbsoluteMaxAgeFilter filter = new SessionAbsoluteMaxAgeFilter(
                Clock.fixed(CREATED_AT.plus(Duration.ofDays(30)), ZoneOffset.UTC),
                Duration.ofDays(30));

        filter.doFilter(request, response, chain);

        verify(session).invalidate();
        verify(chain).doFilter(request, response);
    }

    @Test
    void disabledMaxAgeLeavesSessionAlone() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse response = mock(HttpServletResponse.class);
        HttpSession session = mock(HttpSession.class);
        FilterChain chain = mock(FilterChain.class);
        when(request.getSession(false)).thenReturn(session);

        SessionAbsoluteMaxAgeFilter filter = new SessionAbsoluteMaxAgeFilter(
                Clock.fixed(CREATED_AT.plus(Duration.ofDays(30)), ZoneOffset.UTC),
                Duration.ZERO);

        filter.doFilter(request, response, chain);

        verify(session, never()).invalidate();
        verify(chain).doFilter(request, response);
    }
}
