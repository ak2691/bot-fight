package com.example.botfight.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.config.BotFightSecurityProperties;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServlet;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RequestPayloadLimitFilterTest {

    @Test
    void rejectsDeclaredPayloadLargerThanLimit() throws Exception {
        RequestPayloadLimitFilter filter = filterWithLimit(4);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/bot-submissions");
        request.setContent("12345".getBytes());
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(response.getContentAsString()).contains("Request payload exceeds the allowed size");
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void countsStreamingPayloadWhenContentLengthIsUnknown() throws Exception {
        RequestPayloadLimitFilter filter = filterWithLimit(4);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/bot-submissions") {
            @Override
            public long getContentLengthLong() {
                return -1;
            }
        };
        request.setContent("12345".getBytes());
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain(new HttpServlet() {
            @Override
            protected void doPost(HttpServletRequest servletRequest, HttpServletResponse servletResponse)
                    throws IOException, ServletException {
                servletRequest.getInputStream().readAllBytes();
            }
        });

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
    }

    private RequestPayloadLimitFilter filterWithLimit(int maxBytes) {
        BotFightSecurityProperties properties = new BotFightSecurityProperties();
        properties.setMaxHttpRequestBytes(maxBytes);
        return new RequestPayloadLimitFilter(properties);
    }
}
