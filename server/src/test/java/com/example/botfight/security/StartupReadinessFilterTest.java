package com.example.botfight.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.service.system.StartupReadinessService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class StartupReadinessFilterTest {

    @Test
    void rejectsRequestsUntilStartupRecoveryMarksTheServerReady() throws Exception {
        StartupReadinessService readiness = new StartupReadinessService();
        StartupReadinessFilter filter = new StartupReadinessFilter(readiness);
        MockFilterChain chain = new MockFilterChain();
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(
                new MockHttpServletRequest("GET", "/ws"),
                response,
                chain);

        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("Server is starting");
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void passesRequestsAfterStartupRecoveryMarksTheServerReady() throws Exception {
        StartupReadinessService readiness = new StartupReadinessService();
        readiness.markReady();
        StartupReadinessFilter filter = new StartupReadinessFilter(readiness);
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(
                new MockHttpServletRequest("GET", "/api/auth/me"),
                new MockHttpServletResponse(),
                chain);

        assertThat(chain.getRequest()).isNotNull();
    }
}
