package com.example.botfight.security;

import com.example.botfight.service.system.StartupReadinessService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Blocks HTTP requests, including WebSocket handshakes, until startup
 * reconciliation has completed.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class StartupReadinessFilter extends OncePerRequestFilter {

    private final StartupReadinessService startupReadinessService;

    public StartupReadinessFilter(StartupReadinessService startupReadinessService) {
        this.startupReadinessService = startupReadinessService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (!startupReadinessService.isReady()) {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write(
                    "{\"status\":503,\"message\":\"Server is starting\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}
