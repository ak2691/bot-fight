package com.example.botfight.service;

import com.example.botfight.service.match.connection.MatchConnectionService;

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

    @Test
    void disconnectGraceAlwaysStartsWhenDisconnectIsDetected() {
        Instant now = Instant.parse("2026-07-24T12:00:00Z");
        MatchConnectionService service = new MatchConnectionService(
                Clock.fixed(now, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        service.registerSocket(userId, "socket-current");

        Instant deadline = service.beginDisconnect(userId, "socket-current");

        assertThat(deadline).isEqualTo(now.plusSeconds(30));
    }

    @Test
    void deferredDisconnectDoesNotStartGraceUntilTheNextRoundPromotesIt() {
        Instant now = Instant.parse("2026-07-24T12:00:00Z");
        MatchConnectionService service = new MatchConnectionService(
                Clock.fixed(now, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        service.registerSocket(userId, "socket-current");

        assertThat(service.deferDisconnect(userId, "socket-current")).isTrue();
        assertThat(service.disconnectDeadline(userId)).isNull();
        assertThat(service.hasDeferredDisconnect(userId)).isTrue();

        assertThat(service.startDeferredDisconnect(userId)).isEqualTo(now.plusSeconds(30));
        assertThat(service.hasDeferredDisconnect(userId)).isFalse();
        assertThat(service.disconnectDeadline(userId)).isEqualTo(now.plusSeconds(30));
    }

    @Test
    void reconnectCancelsADeferredDisconnectWithoutCreatingARecoveryNotice() {
        Instant now = Instant.parse("2026-07-24T12:00:00Z");
        MatchConnectionService service = new MatchConnectionService(
                Clock.fixed(now, ZoneOffset.UTC));
        UUID userId = UUID.randomUUID();
        service.registerSocket(userId, "socket-current");
        service.deferDisconnect(userId, "socket-current");

        assertThat(service.reconnect(userId, "socket-new")).isNull();
        assertThat(service.hasDeferredDisconnect(userId)).isFalse();
        assertThat(service.disconnectDeadline(userId)).isNull();
    }
}
