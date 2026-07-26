package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;

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
}
