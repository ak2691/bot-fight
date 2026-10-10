package com.example.botfight.service.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.ArgumentMatchers.any;

import com.example.botfight.service.block.BlockLookup;
import com.example.botfight.service.chatmoderation.ChatEvidenceRecorder;
import com.example.botfight.service.customlobby.CustomLobbyService;
import com.example.botfight.service.customlobby.CustomLobbyStatePublisher;
import com.example.botfight.service.limits.SlidingWindowRateLimiter;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.connection.MatchReconnectionService;
import com.example.botfight.service.match.event.MatchEventFactory;
import com.example.botfight.service.match.event.MatchEventGuard;
import com.example.botfight.service.match.event.MatchEventPublisher;
import com.example.botfight.service.match.state.MatchRuntimeState;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.matchmaking.MatchParticipationCoordinator;
import com.example.botfight.service.rating.EloRatingService;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;

class MatchBeanWiringTest {
    @Test
    void springConstructsOneSharedGraphIncludingSchedulerAndPublisher() {
        Clock clock = Clock.systemUTC();
        TaskScheduler timer = mock(TaskScheduler.class);
        try (var context = new AnnotationConfigApplicationContext()) {
            context.registerBean(Clock.class, () -> clock);
            context.registerBean(JsonMapper.class, () -> new JsonMapper());
            context.registerBean(MatchPersistenceService.class, () -> mock(MatchPersistenceService.class));
            context.registerBean(MatchSimulationService.class, () -> mock(MatchSimulationService.class));
            context.registerBean(EloRatingService.class, () -> mock(EloRatingService.class));
            context.registerBean(BlockLookup.class, BlockLookup::none);
            context.registerBean(ChatEvidenceRecorder.class, ChatEvidenceRecorder::noOp);
            context.registerBean(CustomLobbyService.class, () -> mock(CustomLobbyService.class));
            context.registerBean(CustomLobbyStatePublisher.class, () -> mock(CustomLobbyStatePublisher.class));
            context.registerBean(SimpMessagingTemplate.class, () -> mock(SimpMessagingTemplate.class));
            context.registerBean("matchmakingLifecycleScheduler", TaskScheduler.class, () -> timer);
            context.registerBean("matchSimulationExecutor", AsyncTaskExecutor.class, () -> mock(AsyncTaskExecutor.class));
            context.registerBean("matchmakingRateLimiter", TokenBucketRateLimiter.class,
                    () -> new TokenBucketRateLimiter<UUID>(clock, 3, Duration.ofSeconds(3)));
            context.registerBean("matchChatRateLimiter", TokenBucketRateLimiter.class,
                    () -> new TokenBucketRateLimiter<String>(clock, 10, Duration.ofSeconds(1)));
            context.registerBean("matchCodeViewRateLimiter", SlidingWindowRateLimiter.class,
                    () -> new SlidingWindowRateLimiter<UUID>(clock, 1, Duration.ofSeconds(1)));
            context.register(MatchRuntimeState.class, MatchLockService.class, MatchPhaseService.class,
                    MatchChatService.class, MatchLoadoutService.class, MatchReplayService.class,
                    MatchHistoryService.class, MatchEventFactory.class, MatchSubmissionService.class,
                    MatchLifecycleService.class, MatchEventGuard.class, MatchReconnectionService.class,
                    MatchTimingService.class, MatchRoundResolutionService.class, MatchCodeViewService.class,
                    MatchConnectionService.class, MatchParticipationCoordinator.class, MatchService.class,
                    MatchmakingService.class, MatchScheduler.class, MatchEventPublisher.class);
            context.refresh();

            MatchRuntimeState state = context.getBean(MatchRuntimeState.class);
            assertThat(context.getBeansOfType(MatchRuntimeState.class)).hasSize(1);
            assertThat(ReflectionTestUtils.getField(context.getBean(MatchService.class), "runtimeState")).isSameAs(state);
            assertThat(ReflectionTestUtils.getField(context.getBean(MatchSubmissionService.class), "state")).isSameAs(state);
            assertThat(ReflectionTestUtils.getField(context.getBean(MatchHistoryService.class), "state")).isSameAs(state);
            assertThat(ReflectionTestUtils.getField(context.getBean(MatchEventFactory.class), "historyService"))
                    .isSameAs(context.getBean(MatchHistoryService.class));
            assertThat(context.getBean(MatchEventPublisher.class)).isNotNull();
            verify(timer, times(2)).scheduleWithFixedDelay(any(Runnable.class), any(Duration.class));
        }
    }
}
