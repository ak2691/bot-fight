package com.example.botfight.service.match.event;

import com.example.botfight.DTO.customlobby.CustomLobbyStateEventDTO;
import com.example.botfight.DTO.match.MatchChatEventDTO;
import com.example.botfight.DTO.match.MatchEventType;
import com.example.botfight.controller.MatchmakingSocketDestinations;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.MatchScheduler;
import com.example.botfight.service.match.MatchService;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

/** Fan-out and replay delivery; lifecycle scheduling is owned by match services. */
@Service
public class MatchEventPublisher {
    private final SimpMessagingTemplate messaging;
    private final MatchService matches;
    private final MatchScheduler scheduler;
    private final CustomLobbyService lobbies;
    private final CustomLobbyStatePublisher lobbyPublisher;
    private final Clock clock;

    public MatchEventPublisher(SimpMessagingTemplate messaging, MatchService matches, MatchScheduler scheduler,
            CustomLobbyService lobbies, CustomLobbyStatePublisher lobbyPublisher, Clock clock) {
        this.messaging = messaging;
        this.matches = matches;
        this.scheduler = scheduler;
        this.lobbies = lobbies;
        this.lobbyPublisher = lobbyPublisher;
        this.clock = clock;
    }

    public void publish(List<OutboundMatchmakingEvent> events) { publish(events, null); }
    public void publish(OutboundMatchmakingEvent event) { publish(List.of(event)); }

    public void publish(List<OutboundMatchmakingEvent> events, String destination) {
        if (events == null || events.isEmpty()) return;
        Set<UUID> terminal = events.stream().filter(event -> event.delayMillis() <= 0)
                .filter(matches::isCurrentEvent).filter(event -> event.event().type() == MatchEventType.MATCH_RESULT_READY)
                .map(event -> event.event().matchId()).filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        terminal.forEach(scheduler::cancelPublications);
        for (OutboundMatchmakingEvent outbound : events) {
            if (outbound.schedulerOwned()) continue;
            if (outbound.delayMillis() > 0) {
                if (terminal.contains(outbound.event().matchId()) && outbound.event().type() != MatchEventType.MATCH_RESULT_READY) continue;
                Instant deadline = outbound.publishAt() != null ? outbound.publishAt()
                        : outbound.event().type() == MatchEventType.MATCH_RESULT_READY && outbound.event().resultRevealsAt() != null
                                ? outbound.event().resultRevealsAt() : Instant.now(clock).plusMillis(outbound.delayMillis());
                String key = outbound.principalName() + ":" + outbound.event().type() + ":" + outbound.event().roundNumber()
                        + ":" + (outbound.event().playback() == null ? "" : outbound.event().playback().batchSequence());
                scheduler.publishAt(outbound.event().matchId(), key, deadline, () -> deliver(outbound, destination));
            } else deliver(outbound, destination);
        }
    }

    private void deliver(OutboundMatchmakingEvent outbound, String destination) {
        if (!matches.isCurrentEvent(outbound)) return;
        if (outbound.event().type() == MatchEventType.MATCH_RESULT_READY) {
            matches.revealCompletedMatchResult(outbound.event().matchId());
            matches.expireCompletedMatch(outbound.event().matchId());
            releaseLobby(outbound.event().matchId());
        }
        var payload = outbound.event().type() == MatchEventType.SIMULATION_PREPARING ? outbound.event()
                : outbound.event().toBuilder().serverNow(Instant.now(clock)).build();
        messaging.convertAndSendToUser(outbound.principalName(), destination != null ? destination
                : MatchmakingSocketDestinations.forMatchmakingEvent(payload), payload);
    }

    public void chat(List<String> recipients, MatchChatEventDTO event) {
        recipients.forEach(recipient -> messaging.convertAndSendToUser(recipient, MatchmakingSocketDestinations.MATCH_CHAT, event));
    }

    public void sendToUser(String principal, String destination, Object payload) {
        messaging.convertAndSendToUser(principal, destination, payload);
    }

    private void releaseLobby(UUID matchId) {
        if (matchId == null) return;
        var change = lobbies.finishMatch(matchId);
        if (change == null || change.lobby() == null) return;
        lobbyPublisher.send(change.recipients(), new CustomLobbyStateEventDTO(
                "CUSTOM_LOBBY_STATE", change.lobbyId(), change.lobby(), null, null));
    }
}
