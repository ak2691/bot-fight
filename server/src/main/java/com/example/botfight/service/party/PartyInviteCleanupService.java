package com.example.botfight.service.party;

import java.time.Duration;
import java.time.Instant;
import com.example.botfight.DTO.party.PartyStateEventDTO;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.controller.MatchmakingSocketDestinations;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

/** Periodically expires pending party invites and removes old terminal rows. */
@Service
@DependsOn("matchmakingLifecycleScheduler")
public class PartyInviteCleanupService {

    private final PartyService partyService;
    private final TaskScheduler scheduler;
    private final PartyStatePublisher publisher;
    private final MatchmakingService matchmakingService;
    private final SimpMessagingTemplate messagingTemplate;

    @Autowired
    public PartyInviteCleanupService(
            PartyService partyService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler,
            PartyStatePublisher publisher,
            MatchmakingService matchmakingService,
            SimpMessagingTemplate messagingTemplate) {
        this.partyService = partyService;
        this.scheduler = scheduler;
        this.publisher = publisher;
        this.matchmakingService = matchmakingService;
        this.messagingTemplate = messagingTemplate;
    }

    public PartyInviteCleanupService(PartyService partyService, TaskScheduler scheduler) {
        this(partyService, scheduler, null, null, null);
    }

    @jakarta.annotation.PostConstruct
    void scheduleCleanup() {
        scheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        partyService.cleanupExpiredInvites();
                        for (PartyService.LeaveResult change : partyService.expireOfflineMembers()) {
                            if (matchmakingService != null) matchmakingService.cancelPartyQueue(change.partyId())
                                    .forEach(event -> messagingTemplate.convertAndSendToUser(
                                            event.principalName(), MatchmakingSocketDestinations.MATCHMAKING,
                                            event.event()));
                            if (publisher != null) {
                                publisher.send(change.recipients(), new PartyStateEventDTO(
                                        "PARTY_STATE_UPDATED", change.partyId(), change.party(),
                                        "IDLE", null, null, Instant.now()));
                                if (change.removedRecipient() != null) publisher.send(
                                        java.util.List.of(change.removedRecipient()), new PartyStateEventDTO(
                                                "PARTY_STATE_UPDATED", change.partyId(), null,
                                                "IDLE", null, null, Instant.now()));
                            }
                        }
                    } catch (RuntimeException ignored) {
                        // Cleanup is best-effort; request paths still enforce expiry.
                    }
                },
                Duration.ofSeconds(5));
    }
}
