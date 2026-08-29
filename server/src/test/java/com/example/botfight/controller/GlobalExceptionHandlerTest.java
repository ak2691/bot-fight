package com.example.botfight.controller;

import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.invite.InviteTargetUnavailableException;
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

    @Test
    void onlyInviteTargetFailuresExposeTheirSafeResourceMessage() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/party-invites/test/accept");

        var missingParty = handler.handleForbidden(
                new InviteTargetUnavailableException("Party no longer exists"), request);
        var ordinaryFailure = handler.handleForbidden(
                new AuthException("internal authorization detail"), request);

        assertThat(missingParty.getBody()).isNotNull();
        assertThat(missingParty.getBody().message()).isEqualTo("Party no longer exists");
        assertThat(ordinaryFailure.getBody()).isNotNull();
        assertThat(ordinaryFailure.getBody().message()).isEqualTo("Request is not authorized");
    }
}
