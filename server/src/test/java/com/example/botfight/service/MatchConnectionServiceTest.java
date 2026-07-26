package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchConnectionServiceTest {

    @Test
    void replacementSocketMakesTheOldDisconnectHarmless() {
        Instant now = Instant.parse("2026-07-24T12:00:00Z");
        MatchConnectionService service = new MatchConnectionService(
                Clock.fixed(now, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        service.registerSocket(userId, "socket-old");
        service.registerSocket(userId, "socket-current");

        assertThat(service.beginDisconnect(userId, "socket-old")).isNull();
        assertThat(service.beginDisconnect(userId, "socket-current"))
                .isEqualTo(now.plusSeconds(30));
        assertThat(service.beginDisconnect(userId, "socket-current")).isNull();
    }

    @Test
    void reconnectConsumesThePendingDeadline() {
        Instant now = Instant.parse("2026-07-24T12:00:00Z");
        MatchConnectionService service = new MatchConnectionService(
                Clock.fixed(now, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        service.registerSocket(userId, "socket-old");
        Instant deadline = service.beginDisconnect(userId, "socket-old");

        assertThat(service.reconnect(userId, "socket-new")).isEqualTo(deadline);
        assertThat(service.disconnectDeadline(userId)).isNull();
        assertThat(service.isDisconnected(userId)).isFalse();
    }
}
