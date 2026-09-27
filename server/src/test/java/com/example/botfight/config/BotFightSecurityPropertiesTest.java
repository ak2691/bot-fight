package com.example.botfight.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

class BotFightSecurityPropertiesTest {

    @Test
    void absoluteSessionAgeDefaultsToPositiveThirtyDays() {
        BotFightSecurityProperties properties = new BotFightSecurityProperties();

        assertThat(properties.getSessionMaxAge()).isEqualTo(Duration.ofDays(30));
    }

    @Test
    void credentialedCorsRejectsWildcardOrigins() {
        BotFightSecurityProperties properties = new BotFightSecurityProperties();

        assertThatThrownBy(() -> properties.setAllowedOrigins(List.of("*")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void productionOriginsMustUseHttps() {
        BotFightSecurityProperties properties = new BotFightSecurityProperties();
        properties.setAllowedOrigins(List.of("http://app.example.test"));
        properties.setRequireHttps(true);

        assertThatThrownBy(properties::validate)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Production allowed origins must use HTTPS");
    }

    @Test
    void absoluteSessionAgeMustBePositiveAtConfigurationBinding() {
        BotFightSecurityProperties properties = new BotFightSecurityProperties();

        assertThatThrownBy(() -> properties.setSessionMaxAge(Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Session max age must be positive");
        assertThatThrownBy(() -> properties.setSessionMaxAge(Duration.ofSeconds(-1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Session max age must be positive");
    }
}
