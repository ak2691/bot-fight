package com.example.botfight.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "botfight.security")

public class BotFightSecurityProperties {

    @Value("${botfight.security.allowed-origins}")
    private List<String> allowedOrigins;
    private boolean requireHttps;
    private int maxHttpRequestBytes = 1_048_576;
    private int maxWebSocketMessageBytes = 65_536;
    private int maxWebSocketSendBufferBytes = 4_194_304;

    @PostConstruct
    void validate() {
        for (String origin : allowedOrigins) {
            URI uri;
            try {
                uri = URI.create(origin);
            } catch (IllegalArgumentException exception) {
                throw new IllegalArgumentException("Allowed origins must be valid absolute URLs", exception);
            }
            boolean validScheme = "http".equals(uri.getScheme()) || "https".equals(uri.getScheme());
            if (!validScheme || uri.getHost() == null || uri.getUserInfo() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty())
                    || uri.getQuery() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException("Allowed origins must contain only an HTTP(S) origin");
            }
            if (requireHttps && !"https".equals(uri.getScheme())) {
                throw new IllegalArgumentException("Production allowed origins must use HTTPS");
            }
        }
    }

    public List<String> getAllowedOrigins() {
        return List.copyOf(allowedOrigins);
    }

    public void setAllowedOrigins(List<String> allowedOrigins) {
        if (allowedOrigins == null || allowedOrigins.isEmpty()) {
            throw new IllegalArgumentException("At least one allowed origin must be configured");
        }
        List<String> normalized = allowedOrigins.stream()
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
        if (normalized.isEmpty() || normalized.stream().anyMatch("*"::equals)) {
            throw new IllegalArgumentException("Credentialed CORS requires explicit allowed origins");
        }
        this.allowedOrigins = new ArrayList<>(normalized);
    }

    public boolean isRequireHttps() {
        return requireHttps;
    }

    public void setRequireHttps(boolean requireHttps) {
        this.requireHttps = requireHttps;
    }

    public int getMaxHttpRequestBytes() {
        return maxHttpRequestBytes;
    }

    public void setMaxHttpRequestBytes(int maxHttpRequestBytes) {
        if (maxHttpRequestBytes < 1) {
            throw new IllegalArgumentException("HTTP request limit must be positive");
        }
        this.maxHttpRequestBytes = maxHttpRequestBytes;
    }

    public int getMaxWebSocketMessageBytes() {
        return maxWebSocketMessageBytes;
    }

    public void setMaxWebSocketMessageBytes(int maxWebSocketMessageBytes) {
        if (maxWebSocketMessageBytes < 1) {
            throw new IllegalArgumentException("WebSocket message limit must be positive");
        }
        this.maxWebSocketMessageBytes = maxWebSocketMessageBytes;
    }

    public int getMaxWebSocketSendBufferBytes() {
        return maxWebSocketSendBufferBytes;
    }

    public void setMaxWebSocketSendBufferBytes(int maxWebSocketSendBufferBytes) {
        if (maxWebSocketSendBufferBytes < 1) {
            throw new IllegalArgumentException("WebSocket send buffer limit must be positive");
        }
        this.maxWebSocketSendBufferBytes = maxWebSocketSendBufferBytes;
    }
}
