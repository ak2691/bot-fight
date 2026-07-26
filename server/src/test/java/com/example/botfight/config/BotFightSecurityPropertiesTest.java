package com.example.botfight.config;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class BotFightSecurityPropertiesTest {

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
}
