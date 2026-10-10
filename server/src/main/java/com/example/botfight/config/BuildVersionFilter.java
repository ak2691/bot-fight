package com.example.botfight.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Runs before Security so errors, preflights and denied requests carry the version too. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class BuildVersionFilter extends OncePerRequestFilter {
    private final String version;

    public BuildVersionFilter() throws IOException {
        try (var stream = getClass().getResourceAsStream("/build-version.txt")) {
            version = stream == null ? "development" : new String(stream.readAllBytes(), StandardCharsets.UTF_8).trim();
        }
    }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Build-Version", version);
        chain.doFilter(request, response);
    }
}
