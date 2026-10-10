package com.example.botfight.service.match;

import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.model.MatchSubmissionResult;


import com.example.botfight.DTO.match.MatchEventType;

import com.example.botfight.service.matchmaking.QueuePool;

import com.example.botfight.service.limits.SlidingWindowRateLimiter;

import com.example.botfight.service.chatmoderation.ChatEvidenceRecorder;

import com.example.botfight.service.cache.DatabaseLookupCache;

import com.example.botfight.service.block.BlockLookup;

import com.example.botfight.service.rating.EloRatingService;

import com.example.botfight.service.matchmaking.QueueJoinRequest;

import com.example.botfight.service.matchmaking.MatchParticipationCoordinator;

import com.example.botfight.repository.MatchRoundBotCodeRepository;
import com.example.botfight.repository.PlayerRatingRepository;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import com.example.botfight.support.TestMatches;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.service.simulation.WorkerReplay;
import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.DTO.match.MatchmakingPlayerDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.domain.match.Match;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.domain.match.MatchParticipant;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.domain.submission.BotSubmissionStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.MatchPersistenceService;
import com.example.botfight.service.match.model.*;
import com.example.botfight.service.match.MatchSimulationService;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Objects;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;

abstract class MatchWorkflowFixture {

    protected final com.example.botfight.service.match.MatchScheduler scheduler = mock(com.example.botfight.service.match.MatchScheduler.class);
    protected final MatchSimulationService simulationService = mock(MatchSimulationService.class);
    protected final MatchRepository matchRepository = mock(MatchRepository.class);
    protected final MatchParticipantRepository matchParticipantRepository = mock(MatchParticipantRepository.class);
    protected final ProfileRepository profileRepository = mock(ProfileRepository.class);
    protected final UserRepository userRepository = mock(UserRepository.class);
    protected final MutableClock clock = new MutableClock(Instant.parse("2026-06-03T12:00:00Z"), ZoneOffset.UTC);
    protected final List<MatchSession> simulatedSessions = new ArrayList<>();
    protected final List<MatchParticipant> participants = new ArrayList<>();
    protected final Map<UUID, BotSubmission> persistedSubmissions = new HashMap<>();

    /** The round in which the default stubbed fight ends in a knockout (slot 2's team wins). */
    protected int knockoutRound = FIRST_KNOCKOUT_ROUND;
    protected Match savedMatch;
    protected MatchService service;
    protected com.example.botfight.service.match.event.MatchEventGuard guard;
    protected MatchChatService chat;
    protected com.example.botfight.service.match.event.MatchEventFactory events;
    protected MatchSubmissionService submissions;
    protected MatchLifecycleService lifecycle;
    protected com.example.botfight.service.match.connection.MatchReconnectionService reconnect;
    protected MatchTimingService timing;
    protected MatchRoundResolutionService resolution;
    protected MatchCodeViewService codeView;

    protected MatchmakingService matchmakingService;

    protected MatchmakingPlayerDTO viewerParticipant(MatchmakingEventDTO event) {
        if (event == null || event.viewerUserId() == null || event.players() == null) return null;
        return event.players().stream()
                .filter(participant -> Objects.equals(participant.userId(), event.viewerUserId()))
                .findFirst()
                .orElse(null);
    }

    protected MatchmakingPlayerDTO opponentParticipant(MatchmakingEventDTO event) {
        MatchmakingPlayerDTO viewer = viewerParticipant(event);
        if (viewer == null || event.players() == null) return null;
        return event.players().stream()
                .filter(participant -> participant.teamNumber() != viewer.teamNumber())
                .findFirst()
                .orElse(null);
    }

    protected MatchService createService() {
        var state = new com.example.botfight.service.match.state.MatchRuntimeState(new com.example.botfight.service.match.MatchPhaseService());
        var locks = new com.example.botfight.service.match.MatchLockService();
        var mapper = new tools.jackson.databind.json.JsonMapper();
        var persistence = new MatchPersistenceService(matchRepository, matchParticipantRepository, profileRepository, userRepository, clock, mapper, Mockito.mock(MatchRoundBotCodeRepository.class), new DatabaseLookupCache(), new EloRatingService(Mockito.mock(PlayerRatingRepository.class), Mockito.mock(MatchParticipantRepository.class)));
        var connections = new MatchConnectionService(clock);
        chat = new com.example.botfight.service.match.MatchChatService(clock, state, new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)), BlockLookup.none(), ChatEvidenceRecorder.noOp(), scheduler);
        var loadout = new com.example.botfight.service.match.MatchLoadoutService(mapper);
        var replay = new com.example.botfight.service.match.MatchReplayService();
        var history = new com.example.botfight.service.match.MatchHistoryService(state, mapper);
        events = new com.example.botfight.service.match.event.MatchEventFactory(clock, connections, persistence, chat, loadout, history);
        submissions = new com.example.botfight.service.match.MatchSubmissionService(state, clock, mapper, persistence, loadout, events, scheduler);
        lifecycle = new com.example.botfight.service.match.MatchLifecycleService(state, locks, persistence, connections, events, submissions, chat, clock, new MatchParticipationCoordinator(), scheduler);
        reconnect = new com.example.botfight.service.match.connection.MatchReconnectionService(state, locks, clock, connections, persistence, events, replay, lifecycle, scheduler);
        timing = new com.example.botfight.service.match.MatchTimingService(state, clock, locks, persistence, events, loadout, submissions, scheduler);
        resolution = new com.example.botfight.service.match.MatchRoundResolutionService(state, clock, locks, simulationService, persistence, connections, events, replay, submissions, chat, scheduler);
        codeView = new com.example.botfight.service.match.MatchCodeViewService(clock, state, locks, events, new SlidingWindowRateLimiter<>(clock, 1, Duration.ofSeconds(1)));
        guard = new com.example.botfight.service.match.event.MatchEventGuard(state, clock, locks);
        return new MatchService(state, locks, chat, submissions, lifecycle, guard, reconnect, timing, resolution, codeView);
    }

    @BeforeEach
    void setUp() {
        service = createService();
        matchmakingService = new AutoAcceptingMatchmakingService(
                service,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)));

        when(matchRepository.save(any(Match.class))).thenAnswer(invocation -> {
            savedMatch = invocation.getArgument(0);
            if (savedMatch.getId() == null) {
                savedMatch.setId(UUID.randomUUID());
            }
            return savedMatch;
        });
        when(matchRepository.findById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(savedMatch));
        when(userRepository.getReferenceById(any(UUID.class))).thenAnswer(invocation -> user(invocation.getArgument(0)));
        when(matchParticipantRepository.saveAll(any())).thenAnswer(invocation -> {
            Iterable<MatchParticipant> saved = invocation.getArgument(0);
            List<MatchParticipant> copy = new ArrayList<>();
            saved.forEach(copy::add);
            participants.clear();
            participants.addAll(copy);
            return participants;
        });
        when(matchParticipantRepository.save(any(MatchParticipant.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(matchParticipantRepository.findByMatchId(any(UUID.class))).thenReturn(participants);
        when(matchParticipantRepository.findByMatchIdAndUserId(any(UUID.class), any(UUID.class))).thenAnswer(invocation -> {
            UUID userId = invocation.getArgument(1);
            return participants.stream()
                    .filter(participant -> participant.getUser().getId().equals(userId))
                    .findFirst();
        });
        when(profileRepository.findByUserId(any(UUID.class))).thenReturn(Optional.empty());
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            simulatedSessions.add(session);
            return segment(session, session.roundNumber() >= knockoutRound);
        });
    }

    /** The default stub plays a continuing first round, then slot 2 knocks the other team out in round 2. */
    protected static final int FIRST_KNOCKOUT_ROUND = 2;

    /** A stubbed segment: everyone is standing (it continues), or slot 2's team has won by knockout. */
    protected MatchReplayDTO segment(MatchSession session, boolean knockout) {
        MatchPlayer winner = session.players().stream()
                .filter(player -> player.slot() == 2)
                .findFirst()
                .orElseThrow();
        List<WorkerReplay.EndBotState> end = session.players().stream()
                .map(player -> replayBot(player, knockout && player.teamNumber() != winner.teamNumber() ? 0 : 150))
                .toList();
        return replay(knockout ? "BOT_WIN" : "CONTINUES", knockout ? winner.userId() : null,
                knockout ? winner.teamNumber() : null, knockout ? "KO" : "SEGMENT_END", end, List.of(100));
    }

    /** The first round of these stubbed fights continues; from the second round slot 2 wins by knockout. */
    protected static String outcome(MatchSession session) {
        return session.roundNumber() >= FIRST_KNOCKOUT_ROUND ? "BOT_WIN" : "CONTINUES";
    }

    protected static UUID knockoutWinner(MatchSession session, UUID winnerUserId) {
        return session.roundNumber() >= FIRST_KNOCKOUT_ROUND ? winnerUserId : null;
    }

    protected static WorkerReplay.EndBotState replayBot(MatchPlayer player, double hp) {
        return new WorkerReplay.EndBotState(player.slot(),100,100,0.0,hp,player.teamNumber(),100,false,null);
    }

    // ---- timed rounds: clocks, picks and endings -----------------------------------------------

    protected static final String BRAIN = "{}";

    protected MatchmakingPlayerDTO playerOf(MatchmakingEventDTO event, UUID userId) {
        return event.players().stream()
                .filter(player -> player.userId().equals(userId))
                .findFirst()
                .orElseThrow();
    }

    /** What each player already owns, as the server last reported it; a round's pick must keep all of it. */
    protected final Map<UUID, String> carriedLoadouts = new HashMap<>();

    /** Locks a player's pick for the round by sending their carried loadout, so the server adds the offers. */
    protected List<OutboundMatchmakingEvent> pick(UUID userId) {
        List<OutboundMatchmakingEvent> events = TestMatches.selectLoadout(service, userId, carriedLoadouts.getOrDefault(userId, "custom:"));
        events.stream().map(OutboundMatchmakingEvent::event).findFirst().ifPresent(event ->
                event.players().forEach(player -> carriedLoadouts.put(player.userId(), player.selectedLoadout())));
        return events;
    }

    /** Both players queue into a 1v1 and pick, which opens round 1's build. Returns the build-start events. */
    protected List<OutboundMatchmakingEvent> startDuelBuild(UUID first, UUID second) {
        matchmakingService.joinQueue(new QueueJoinRequest(
                first,
                "pilot-one",
                "pilot-one@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        matchmakingService.joinQueue(new QueueJoinRequest(
                second,
                "pilot-two",
                "pilot-two@example.com",
                null,
                MatchMode.ONES,
                null,
                null,
                QueuePool.REGISTERED));
        pick(first);
        return pick(second);
    }

    protected List<OutboundMatchmakingEvent> submit(UUID userId) {
        UUID submissionId = UUID.randomUUID();
        stubSubmission(userId, submissionId, BRAIN);
        return submitMatch(userId, submissionId);
    }

    /** Plays one round: both pick (the server fills anything missing), build, submit, and simulate. */
    protected List<OutboundMatchmakingEvent> playRound(UUID first, UUID second, boolean firstRound) {
        if (!firstRound) {
            pick(first);
            pick(second);
        }
        submit(first);
        submit(second);
        return service.completeSimulation(savedMatch.getId());
    }

    protected void openNextRound(List<OutboundMatchmakingEvent> roundEvents) {
        List<OutboundMatchmakingEvent> ready = roundEvents.stream()
                .filter(event -> MatchEventType.MATCH_ROUND_READY.equals(event.event().type()))
                .toList();
        assertThat(ready).isNotEmpty();
        clock.advance(Duration.between(clock.instant(), ready.getFirst().event().roundReadyAt()));
        ready.forEach(event -> service.beginNextRound(event.event().matchId(), event.event().roundNumber() - 1));
    }

    protected MatchmakingEventDTO lastEventFor(List<OutboundMatchmakingEvent> events, UUID userId) {
        return events.stream()
                .map(OutboundMatchmakingEvent::event)
                .filter(event -> userId.equals(event.viewerUserId()))
                .reduce((a, b) -> b)
                .orElseThrow();
    }

    protected static Integer codeToId(char code) {
        return AbilityCatalog.idForCode(String.valueOf(code));
    }

    /** A final-segment result: round 6 runs out of time with both teams standing and the given team HP. */
    protected MatchReplayDTO finalSegment(MatchSession session, double blueHp, double redHp) {
        List<WorkerReplay.EndBotState> end = session.players().stream()
                .map(player -> replayBot(player, player.teamNumber() == 1 ? blueHp : redHp))
                .toList();
        boolean lastRound = session.roundNumber() >= 6;
        Integer winningTeam = !lastRound || blueHp == redHp ? null : blueHp > redHp ? 1 : 2;
        UUID winner = winningTeam == null ? null : session.players().stream().filter(p -> p.teamNumber()==winningTeam)
                .map(MatchPlayer::userId).findFirst().orElseThrow();
        return replay(lastRound ? winner == null ? "DRAW" : "BOT_WIN" : "CONTINUES", winner, winningTeam,
                lastRound ? "HP_DECISION" : "SEGMENT_END", end, List.of(100));
    }

    protected List<OutboundMatchmakingEvent> playToTheLastRound(UUID first, UUID second) {
        List<OutboundMatchmakingEvent> events = null;
        startDuelBuild(first, second);
        events = playRound(first, second, true);
        for (int round = 2; round <= 6; round++) {
            openNextRound(events);
            events = playRound(first, second, false);
        }
        return events;
    }

    protected void stubSubmission(UUID userId, UUID submissionId) {
        stubSubmission(userId, submissionId, "{}");
    }

    protected BotSubmission inMemorySubmission(UUID matchId, String fingerprint) {
        BotSubmission submission = new BotSubmission();
        submission.setMatchId(matchId);
        submission.setRequestFingerprint(fingerprint);
        submission.setSelectedLoadout("melee");
        submission.setBrainSchemaVersion("bot-logic-tree-v2");
        submission.setBrainPayload("{}");
        submission.setStatus(BotSubmissionStatus.VALIDATED);
        return submission;
    }

    protected void stubSubmission(UUID userId, UUID submissionId, String brainPayload) {
        BotSubmission submission = new BotSubmission();
        submission.setId(submissionId);
        submission.setUser(user(userId));
        submission.setBrainSchemaVersion("bot-logic-tree-v2");
        submission.setMatchId(savedMatch.getId());
        submission.setBrainPayload(brainPayload);
        submission.setSelectedLoadout("melee");
        submission.setStatus(BotSubmissionStatus.VALIDATED);
        persistedSubmissions.put(submissionId, submission);
    }

    protected List<OutboundMatchmakingEvent> submitMatch(UUID userId, UUID submissionId) {
        BotSubmission submission = persistedSubmissions.get(submissionId);
        assertThat(submission).isNotNull();
        MatchSubmissionResult result = TestMatches.acceptMatchSubmission(service, userId, savedMatch.getId(), submission);
        assertThat(result.accepted()).isTrue();
        return result.events();
    }

    protected int loadoutAbilityCodeCount(String selectedLoadout) {
        return loadoutAbilityCodes(selectedLoadout).length();
    }

    protected String loadoutAbilityCodes(String selectedLoadout) {
        return selectedLoadout == null ? "" : selectedLoadout.split(":", -1)[1];
    }

    protected AppUser user(UUID userId) {
        AppUser user = new AppUser();
        user.setId(userId);
        user.setUsername("pilot");
        user.setEmail(userId + "@example.com");
        user.setNormalizedEmail(userId + "@example.com");
        return user;
    }

    protected static final class AutoAcceptingMatchmakingService extends MatchmakingService {
        protected UUID queuedUserId;

        protected AutoAcceptingMatchmakingService(
                MatchService matchService,
                Clock clock,
                TokenBucketRateLimiter<UUID> matchmakingRateLimiter) {
            super(matchService, clock, matchmakingRateLimiter, new EloRatingService(mock(PlayerRatingRepository.class), mock(MatchParticipantRepository.class)), new MatchParticipationCoordinator(), mock(com.example.botfight.service.match.MatchScheduler.class));
        }

        @Override
        public synchronized List<OutboundMatchmakingEvent> joinQueue(QueueJoinRequest request) {
            UUID userId = request.userId();
            String username = request.username();
            String principalName = request.principalName();
            String socketSessionId = request.socketSessionId();
            List<OutboundMatchmakingEvent> events = super.joinQueue(new QueueJoinRequest(
                    userId,
                    username,
                    principalName,
                    socketSessionId,
                    MatchMode.ONES,
                    null,
                    null,
                    QueuePool.REGISTERED));
            if (events.size() != 2
                    || !MatchEventType.MATCH_FOUND.equals(events.getFirst().event().type())
                    || !"MATCH_ACCEPT".equals(events.getFirst().event().status())) {
                if (events.size() == 1 && MatchEventType.QUEUE_WAITING.equals(events.getFirst().event().type())) {
                    queuedUserId = userId;
                }
                return events;
            }
            UUID pendingMatchId = events.getFirst().event().matchId();
            UUID firstUserId = queuedUserId;
            UUID secondUserId = userId;
            super.acceptMatch(pendingMatchId, firstUserId, null);
            return super.acceptMatch(pendingMatchId, secondUserId, null);
        }
    }

    protected static final class MutableClock extends Clock {
        protected Instant instant;
        protected final ZoneId zone;

        protected MutableClock(Instant instant, ZoneId zone) {
            this.instant = instant;
            this.zone = zone;
        }

        protected void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return zone;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return new MutableClock(instant, zone);
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
