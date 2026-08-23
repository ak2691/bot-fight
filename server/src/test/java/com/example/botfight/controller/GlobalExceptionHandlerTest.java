package com.example.botfight.controller;

import com.example.botfight.service.limits.RateLimitExceededException;
import static org.assertj.core.api.Assertions.assertThat;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;

class GlobalExceptionHandlerTest {

    @Test
    void unexpectedErrorsReturnGenericMessageAndCorrelationId() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/test");

        var response = handler.handleUnexpected(
                new IllegalStateException("sensitive database implementation detail"),
                request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().message()).isEqualTo("An unexpected error occurred");
        assertThat(response.getBody().message()).doesNotContain("database", "IllegalStateException");
        assertThat(response.getBody().requestId()).isNotBlank();
    }

    @Test
    void rateLimitErrorsReturnTheGenericMessageAndRetryAfterHeader() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/test");

        var response = handler.handleRateLimit(
                new RateLimitExceededException(Duration.ofSeconds(4)),
                request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("4");
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().message()).isEqualTo(RateLimitExceededException.GENERIC_MESSAGE);
        assertThat(response.getBody().requestId()).isNotBlank();
    }
}
