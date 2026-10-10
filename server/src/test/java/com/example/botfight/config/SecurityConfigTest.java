package com.example.botfight.config;

import static org.mockito.Mockito.mock;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.botfight.security.GoogleOAuth2AuthenticationFailureHandler;
import com.example.botfight.security.GoogleOAuth2AuthenticationSuccessHandler;
import java.time.Clock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitConfig(SecurityConfigTest.TestConfig.class)
@WebAppConfiguration
@TestPropertySource(properties = "botfight.security.allowed-origins=http://localhost")
class SecurityConfigTest {
    @Autowired
    private WebApplicationContext context;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/admin/puzzles/probe", "/api/admin/chat-reports/probe", "/api/admin/future/probe"})
    void adminRoutesRequireAdminRole(String path) throws Exception {
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path).with(user("player").roles("USER"))).andExpect(status().isForbidden());
        mvc.perform(get(path).with(user("admin").roles("ADMIN"))).andExpect(status().isOk());
    }

    @Configuration
    @EnableWebMvc
    @Import(SecurityConfig.class)
    static class TestConfig {
        @Bean
        Clock clock() {
            return Clock.systemUTC();
        }

        @Bean
        GoogleOAuth2AuthenticationSuccessHandler successHandler() {
            return mock(GoogleOAuth2AuthenticationSuccessHandler.class);
        }

        @Bean
        GoogleOAuth2AuthenticationFailureHandler failureHandler() {
            return mock(GoogleOAuth2AuthenticationFailureHandler.class);
        }

        @Bean
        ClientRegistrationRepository clientRegistrations() {
            return new InMemoryClientRegistrationRepository(ClientRegistration.withRegistrationId("test")
                    .clientId("test-client")
                    .clientSecret("test-secret")
                    .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                    .redirectUri("http://localhost/login/oauth2/code/test")
                    .authorizationUri("http://localhost/oauth/authorize")
                    .tokenUri("http://localhost/oauth/token")
                    .userInfoUri("http://localhost/oauth/user")
                    .userNameAttributeName("sub")
                    .clientName("test")
                    .build());
        }

        @Bean
        AdminProbeController adminProbeController() {
            return new AdminProbeController();
        }
    }

    @RestController
    static class AdminProbeController {
        @GetMapping("/api/admin/**")
        String probe() {
            return "ok";
        }
    }
}
