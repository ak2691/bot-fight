package com.example.botfight.config;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class BuildVersionFilterTest {
    @Test void versionIsAlreadyPresentWhenSecurityDeniesTheRequest() throws Exception {
        var response = new MockHttpServletResponse();
        new BuildVersionFilter().doFilter(new MockHttpServletRequest("GET", "/api/private"), response,
                (request, reply) -> {
                    assertThat(response.getHeader("X-Build-Version")).isNotBlank();
                    response.sendError(403);
                });
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getHeader("X-Build-Version")).isNotBlank();
    }
}
