package com.example.botfight.service.customlobby;

import java.time.Duration;
import com.example.botfight.DTO.customlobby.CustomLobbyStateEventDTO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.DependsOn;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

/** Periodically removes expired and terminal custom-lobby invites. */
@Service
@DependsOn("matchmakingLifecycleScheduler")
public class CustomLobbyInviteCleanupService {

    private final CustomLobbyService customLobbyService;
    private final TaskScheduler scheduler;
    private final CustomLobbyStatePublisher publisher;

    @Autowired
    public CustomLobbyInviteCleanupService(
            CustomLobbyService customLobbyService,
            @Qualifier("matchmakingLifecycleScheduler") TaskScheduler scheduler,
            CustomLobbyStatePublisher publisher) {
        this.customLobbyService = customLobbyService;
        this.scheduler = scheduler;
        this.publisher = publisher;
    }

    public CustomLobbyInviteCleanupService(CustomLobbyService service, TaskScheduler scheduler) {
        this(service, scheduler, null);
    }

    @jakarta.annotation.PostConstruct
    void scheduleCleanup() {
        scheduler.scheduleWithFixedDelay(
                () -> {
                    try {
                        customLobbyService.cleanupExpiredInvites();
                        for (CustomLobbyService.LobbyChange change : customLobbyService.expireOfflineMembers()) {
                            if (publisher == null) continue;
                            publisher.send(change.recipients(), new CustomLobbyStateEventDTO(
                                    "CUSTOM_LOBBY_STATE", change.lobbyId(), change.lobby(), null, null));
                            publisher.send(change.detachedRecipients(), new CustomLobbyStateEventDTO(
                                    "CUSTOM_LOBBY_STATE", change.lobbyId(), null, null,
                                    "You are no longer in this custom lobby."));
                        }
                    } catch (RuntimeException ignored) {
                        // Cleanup is best-effort; request paths still enforce expiry.
                    }
                },
                Duration.ofSeconds(5));
    }
}
