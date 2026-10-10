package com.example.botfight.support;

import com.example.botfight.controller.MatchmakingSocketController;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.match.MatchScheduler;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.connection.MatchSocketConnections;
import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.matchmaking.MatchmakingSocketActions;
import com.example.botfight.service.party.PartyService;
import com.example.botfight.service.party.PartyStatePublisher;
import com.example.botfight.service.websocket.SingleUserWebSocketSessionRegistry;
import java.time.Clock;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;

/** Test-only assembly for the socket boundary and its collaborators. */
public final class TestMatchSockets {
    private TestMatchSockets() {}

    public static MatchmakingSocketController controller(MatchmakingService matchmaking, MatchService matches,
            SimpMessagingTemplate messaging, CurrentUserService users, PartyService parties,
            PartyStatePublisher partyPublisher, TaskScheduler tasks, AsyncTaskExecutor executor,
            SingleUserWebSocketSessionRegistry registry, CustomLobbyService lobbies, CustomLobbyStatePublisher lobbyPublisher) {
        Clock clock = Clock.systemUTC();
        MatchEventPublisher callbackPublisher = org.mockito.Mockito.mock(MatchEventPublisher.class);
        MatchScheduler scheduler = new MatchScheduler(tasks, executor, matches, matchmaking, callbackPublisher, clock);
        MatchEventPublisher publisher = new MatchEventPublisher(messaging, matches, scheduler, lobbies, lobbyPublisher, clock);
        return new MatchmakingSocketController(matches, users, publisher,
                new MatchmakingSocketActions(matchmaking, matches, users, parties, partyPublisher, publisher),
                new MatchSocketConnections(matchmaking, matches, users, parties, partyPublisher, registry, scheduler));
    }
}
