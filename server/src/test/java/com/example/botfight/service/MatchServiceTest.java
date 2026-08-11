package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.MatchStatus;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.BotSubmissionStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.BotSubmissionRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.repository.ValidationResultRepository;
import com.example.botfight.service.MatchService.MatchSession;
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
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

class MatchServiceTest {

    private final MatchSimulationService simulationService = mock(MatchSimulationService.class);
    private final MatchRepository matchRepository = mock(MatchRepository.class);
    private final MatchParticipantRepository matchParticipantRepository = mock(MatchParticipantRepository.class);
    private final BotSubmissionRepository botSubmissionRepository = mock(BotSubmissionRepository.class);
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final ValidationResultRepository validationResultRepository = mock(ValidationResultRepository.class);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-06-03T12:00:00Z"), ZoneOffset.UTC);
    private final List<MatchSession> simulatedSessions = new ArrayList<>();
    private final List<MatchParticipant> participants = new ArrayList<>();
    private final Map<UUID, BotSubmission> persistedSubmissions = new HashMap<>();

    private Match savedMatch;
    private MatchService service;
    private MatchmakingService matchmakingService;

    @BeforeEach
    void setUp() {
        service = new MatchService(
                simulationService,
                new MatchPersistenceService(
                        matchRepository,
                        matchParticipantRepository,
                        botSubmissionRepository,
                        profileRepository,
                        userRepository,
                        validationResultRepository,
                        clock,
                        new tools.jackson.databind.json.JsonMapper()),
                new MatchConnectionService(clock),
                clock);
        matchmakingService = new AutoAcceptingMatchmakingService(
                service,
                clock,
                new MatchmakingRateLimiter(clock));

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
        when(botSubmissionRepository.save(any(BotSubmission.class))).thenAnswer(invocation -> {
            BotSubmission submission = invocation.getArgument(0);
            if (submission.getId() == null) submission.setId(UUID.randomUUID());
            persistedSubmissions.put(submission.getId(), submission);
            return submission;
        });
        when(botSubmissionRepository.findByIdAndUserId(any(UUID.class), any(UUID.class)))
                .thenAnswer(invocation -> Optional.ofNullable(persistedSubmissions.get(invocation.getArgument(0))));
        when(botSubmissionRepository.findByUserIdAndBuildingSessionIdAndRequestFingerprintIsNotNull(
                any(UUID.class), any(String.class))).thenReturn(Optional.empty());
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            simulatedSessions.add(session);
            MatchService.MatchPlayer winner = session.players().stream()
                    .filter(player -> player.slot() == 2)
                    .findFirst()
                    .orElseThrow();
            return new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    List.of(),
                    "BOT_WIN",
                    winner.userId(),
                    winner.username() + " wins the fight.");
        });
    }

    @Test
    void blockedTransitionInOneMatchDoesNotBlockAnotherMatch() throws Exception {
        UUID firstMatchFirstUser = UUID.randomUUID();
        UUID firstMatchSecondUser = UUID.randomUUID();
        UUID secondMatchFirstUser = UUID.randomUUID();
        UUID secondMatchSecondUser = UUID.randomUUID();
        UUID firstMatchId = service.startMatch(
                        new MatchService.MatchEntrant(firstMatchFirstUser, "alpha-one", "alpha-one@example.com", null),
                        new MatchService.MatchEntrant(firstMatchSecondUser, "alpha-two", "alpha-two@example.com", null))
                .getFirst().event().matchId();
        UUID secondMatchId = service.startMatch(
                        new MatchService.MatchEntrant(secondMatchFirstUser, "beta-one", "beta-one@example.com", null),
                        new MatchService.MatchEntrant(secondMatchSecondUser, "beta-two", "beta-two@example.com", null))
                .getFirst().event().matchId();
        service.selectLoadout(firstMatchFirstUser, "melee");

        CountDownLatch firstMatchEnteredBlockedWork = new CountDownLatch(1);
        CountDownLatch releaseFirstMatch = new CountDownLatch(1);
        when(matchParticipantRepository.findByMatchIdAndUserId(any(UUID.class), any(UUID.class))).thenAnswer(invocation -> {
            UUID matchId = invocation.getArgument(0);
            UUID userId = invocation.getArgument(1);
            if (matchId.equals(firstMatchId)) {
                firstMatchEnteredBlockedWork.countDown();
                if (!releaseFirstMatch.await(5, TimeUnit.SECONDS)) {
                    throw new AssertionError("timed out waiting to release the first match");
                }
                return Optional.empty();
            }
            return participants.stream()
                    .filter(participant -> participant.getUser().getId().equals(userId))
                    .findFirst();
        });

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<List<MatchService.OutboundMatchmakingEvent>> blockedFirstMatch =
                    executor.submit(() -> service.selectLoadout(firstMatchSecondUser, "melee"));
            assertThat(firstMatchEnteredBlockedWork.await(2, TimeUnit.SECONDS)).isTrue();

            Future<List<MatchService.OutboundMatchmakingEvent>> independentSecondMatch =
                    executor.submit(() -> service.selectLoadout(secondMatchFirstUser, "melee"));
            assertThat(independentSecondMatch.get(1, TimeUnit.SECONDS))
                    .isNotEmpty()
                    .allSatisfy(outbound -> assertThat(outbound.event().matchId()).isEqualTo(secondMatchId));

            releaseFirstMatch.countDown();
            assertThat(blockedFirstMatch.get(2, TimeUnit.SECONDS)).isNotEmpty();
        } finally {
            releaseFirstMatch.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void ratedReplayStreamsTheAuthoritativeResultWithTheBufferedTerminalFrame() {
        List<String> preparationSteps = new ArrayList<>();
        List<Integer> authoritativeElapsedMs = new ArrayList<>();
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            preparationSteps.add("simulation");
            MatchSession session = invocation.getArgument(0);
            MatchService.MatchPlayer winner = session.players().getLast();
            MatchPlaybackDTO.ArenaStateDTO state =
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of());
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
            for (int elapsedMs = 0, tick = 0; elapsedMs <= 50_500; elapsedMs += 100, tick++) {
                authoritativeElapsedMs.add(elapsedMs);
                frames.add(new MatchPlaybackDTO.ReplayFrameDTO(tick, elapsedMs, List.of(), List.of()));
            }
            return new MatchPlaybackDTO(
                    session.matchId(), MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED", state, frames, "BOT_WIN", winner.userId(), "winner");
        });
        when(simulationService.buildPreparationPlayback(any(MatchSession.class))).thenAnswer(invocation -> {
            preparationSteps.add("preparation");
            return preparationPlayback(invocation.getArgument(0));
        });
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        service.markFinished(firstUserId, firstSubmissionId);

        List<MatchService.OutboundMatchmakingEvent> preparingEvents =
                service.markFinished(secondUserId, secondSubmissionId);
        assertThat(preparingEvents).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo("SIMULATION_LOADING"));
        assertThat(preparingEvents).allSatisfy(outbound ->
                assertThat(outbound.event().playbackStartsAt()).isNull());
        assertThat(simulatedSessions).isEmpty();
        clock.advance(Duration.ofSeconds(7));
        List<MatchService.OutboundMatchmakingEvent> events =
                service.completeSimulation(savedMatch.getId());

        assertThat(preparationSteps).containsExactly("simulation");
        assertThat(events.stream()
                .filter(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .map(outbound -> outbound.event().type())
                .toList())
                .startsWith("SIMULATION_PREPARING", "MATCH_REPLAY_BATCH")
                .endsWith("MATCH_REPLAY_BATCH", "MATCH_ROUND_READY");

        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().serverNow()).isEqualTo(clock.instant());
                    assertThat(outbound.event().playbackStartsAt()).isEqualTo(clock.instant().plusSeconds(3));
                    assertThat(outbound.event().simulationPreparingDurationMs()).isEqualTo(3_000L);
                    assertThat(outbound.event().playback().frames()).isEmpty();
                    assertThat(outbound.event().roundBrains()).isEmpty();
                    assertThat(outbound.event().abilityOffers()).isEmpty();
                });

        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().playback().winnerUserId()).isNull();
                    assertThat(outbound.event().playback().result()).isNull();
                    assertThat(outbound.event().playbackStartsAt()).isEqualTo(clock.instant().plusSeconds(3));
                    assertThat(outbound.event().resultRevealsAt()).isAfter(outbound.event().playbackStartsAt());
                    assertThat(outbound.event().roundReadyAt()).isAfter(outbound.event().resultRevealsAt());
                    assertThat(outbound.event().player()).isNotNull();
                    assertThat(outbound.event().opponent()).isNotNull();
                    assertThat(outbound.event().players()).hasSize(2);
                    assertThat(outbound.delayMillis()).isZero();
                    assertThat(outbound.publishAt()).isNull();
                });
        List<MatchService.OutboundMatchmakingEvent> replayBatches = events.stream()
                .filter(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .filter(outbound -> outbound.event().type().equals("MATCH_REPLAY_BATCH"))
                .toList();
        assertThat(replayBatches).isNotEmpty();
        assertThat(replayBatches.getFirst().delayMillis()).isEqualTo(2_000L);
        assertThat(replayBatches.getFirst().publishAt()).isEqualTo(clock.instant().plusSeconds(2));
        assertThat(replayBatches.getFirst().event().playback().frames().getLast().elapsedMs())
                .isEqualTo(1_000);
        assertThat(replayBatches.getLast().delayMillis()).isEqualTo(51_500L);
        assertThat(replayBatches.getLast().publishAt()).isEqualTo(clock.instant().plusMillis(51_500));
        assertThat(replayBatches.getLast().event().playback().terminalBatch()).isTrue();
        assertThat(replayBatches.getLast().event().playback().frames().getLast().elapsedMs())
                .isEqualTo(50_500);
        assertThat(replayBatches.getLast().event().playback().winnerUserId())
                .isIn(firstUserId, secondUserId);
        assertThat(replayBatches.stream()
                .flatMap(outbound -> outbound.event().playback().frames().stream())
                .map(MatchPlaybackDTO.ReplayFrameDTO::elapsedMs)
                .toList()).containsExactlyElementsOf(authoritativeElapsedMs);
        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.delayMillis()).isEqualTo(56_500L);
                    assertThat(outbound.event().resultRevealsAt())
                            .isEqualTo(clock.instant().plusMillis(53_500));
                    assertThat(outbound.event().roundReadyAt())
                            .isEqualTo(clock.instant().plusMillis(56_500));
                    assertThat(outbound.publishAt()).isEqualTo(outbound.event().roundReadyAt());
                    assertThat(outbound.event().loadoutSelectionEndsAt()).isNull();
                });
        assertThat(service.selectLoadout(firstUserId, "melee")).isEmpty();
        assertThat(service.selectLoadout(secondUserId, "melee")).isEmpty();
        assertThat(service.resolveLoadoutSelectionTimeout(savedMatch.getId()))
                .as("a stale prior-round timeout cannot advance a round whose selection is not active")
                .isEmpty();
        List<MatchService.OutboundMatchmakingEvent> activatedRoundEvents = events.stream()
                .filter(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .map(service::activateRoundLoadoutSelection)
                .toList();
        assertThat(activatedRoundEvents).allSatisfy(outbound ->
                assertThat(outbound.event().loadoutSelectionEndsAt())
                        .isEqualTo(clock.instant().plusSeconds(62)));
        assertThat(service.matchChatCloseAt(savedMatch.getId())).isNull();
    }

    @Test
    void terminalSeriesCompletionWinsTheDisconnectRaceAndStartsNoNewGracePeriod() {
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            MatchService.MatchPlayer winner = session.players().getLast();
            return new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    List.of(),
                    "BOT_WIN",
                    winner.userId(),
                    "winner");
        });
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        String secondPrincipal = "pilot-two@example.com";
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", secondPrincipal);
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        List<MatchService.OutboundMatchmakingEvent> roundEvents =
                service.completeSimulation(savedMatch.getId());
        UUID roundLeaderUserId = roundEvents.stream()
                .filter(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .findFirst()
                .orElseThrow()
                .event()
                .players()
                .stream()
                .filter(player -> player.roundWins() == 1)
                .map(player -> player.userId())
                .findFirst()
                .orElseThrow();
        String roundLeaderPrincipal = roundLeaderUserId.equals(firstUserId) ? firstPrincipal : secondPrincipal;
        UUID winnerUserId = roundLeaderUserId.equals(firstUserId) ? secondUserId : firstUserId;

        Instant deadline = service.markDisconnected(roundLeaderPrincipal).getFirst().event().disconnectEndsAt();
        clock.advance(Duration.ofSeconds(30));
        List<MatchService.OutboundMatchmakingEvent> results =
                service.resolveDisconnectTimeout(roundLeaderPrincipal, deadline);

        assertThat(results).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("DISCONNECTION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(winnerUserId);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(roundLeaderUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.FORFEIT);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(winnerUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.WIN);
        assertThat(results).allSatisfy(outbound ->
                assertThat(outbound.event().playback().result()).isEqualTo("DISCONNECTION_WIN"));
    }

    @Test
    void bothPlayersDisconnectingAfterFirstRoundCompletesMatchAsDraw() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        String secondPrincipal = "pilot-two@example.com";
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", secondPrincipal);
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        Instant firstDeadline =
                service.markDisconnected(firstPrincipal).getFirst().event().disconnectEndsAt();
        service.markDisconnected(secondPrincipal);
        clock.advance(Duration.ofSeconds(30));
        List<MatchService.OutboundMatchmakingEvent> results =
                service.resolveDisconnectTimeout(firstPrincipal, firstDeadline);

        assertThat(results).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("MUTUAL_DISCONNECTION");
        assertThat(savedMatch.getWinnerUser()).isNull();
        assertThat(participants).allSatisfy(participant ->
                assertThat(participant.getResult()).isEqualTo(MatchResult.DRAW));
        assertThat(results).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().result()).isEqualTo("DRAW");
            assertThat(outbound.event().playback().winnerUserId()).isNull();
        });
        assertThat(service.markDisconnected(firstPrincipal)).isEmpty();
        assertThat(service.markDisconnected(secondPrincipal)).isEmpty();
        assertThat(savedMatch.getWinnerUser()).isNull();
    }

    @Test
    void reconnectCancelsPendingDisconnectForfeit() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        Instant deadline = service.markDisconnected(firstPrincipal).get(0).event().disconnectEndsAt();

        List<MatchService.OutboundMatchmakingEvent> reconnectEvents =
                service.resumeMatch(firstUserId, "pilot-one", firstPrincipal, "socket-reconnected");
        clock.advance(Duration.ofSeconds(31));

        assertThat(reconnectEvents)
                .extracting(outbound -> outbound.event().type())
                .contains("MATCH_FOUND", "PLAYER_RECONNECTED");
        assertThat(service.resolveDisconnectTimeout(firstPrincipal, deadline)).isEmpty();
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Test
    void disconnectFromSupersededSocketDoesNotDisconnectCurrentMatchSession() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal, "socket-old");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com", "socket-two");

        service.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-current");

        assertThat(service.markDisconnected(firstPrincipal, "socket-old")).isEmpty();
        List<MatchService.OutboundMatchmakingEvent> notices =
                service.markDisconnected(firstPrincipal, "socket-current");

        assertThat(notices).hasSize(2);
        assertThat(notices).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_DISCONNECTED");
            assertThat(outbound.event().disconnectEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });
    }

    @Test
    void duplicateDisconnectFromSameSocketDoesNotRestartGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal, "socket-one");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com", "socket-two");

        List<MatchService.OutboundMatchmakingEvent> firstNotice =
                service.markDisconnected(firstPrincipal, "socket-one");
        clock.advance(Duration.ofSeconds(1));
        List<MatchService.OutboundMatchmakingEvent> duplicateNotice =
                service.markDisconnected(firstPrincipal, "socket-one");

        assertThat(firstNotice).hasSize(2);
        assertThat(duplicateNotice).isEmpty();
        assertThat(firstNotice.getFirst().event().disconnectEndsAt())
                .isEqualTo(Instant.parse("2026-06-03T12:00:30Z"));
    }

    @Test
    void surrenderCompletesMatchAsResignationWinForOpponent() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<MatchService.OutboundMatchmakingEvent> events = service.surrender(firstUserId);

        assertThat(events).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(firstUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.FORFEIT);
        assertThat(participants)
                .filteredOn(participant -> participant.getUser().getId().equals(secondUserId))
                .singleElement()
                .extracting(MatchParticipant::getResult)
                .isEqualTo(MatchResult.WIN);
        assertThat(events).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
            assertThat(outbound.event().playback().message()).isEqualTo("pilot-two wins by resignation.");
            assertThat(outbound.delayMillis()).isZero();
            assertThat(outbound.event().matchChatEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });
        assertThat(service.matchChatCloseAt(savedMatch.getId()))
                .isEqualTo(clock.instant().plusSeconds(30));
        assertThat(service.markDisconnected("pilot-one@example.com")).isEmpty();
        assertThat(service.markDisconnected("pilot-two@example.com")).isEmpty();
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Test
    void matchChatIsServerConfirmedAndRateLimitedPerSender() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        MatchService.MatchChatSubmission first =
                service.submitChatMessage(firstUserId, savedMatch.getId(), "  ready?  ");
        service.submitChatMessage(firstUserId, savedMatch.getId(), "two");
        service.submitChatMessage(firstUserId, savedMatch.getId(), "three");
        MatchService.MatchChatSubmission limited =
                service.submitChatMessage(firstUserId, savedMatch.getId(), "four");

        assertThat(first.status()).isEqualTo(MatchService.MatchChatSubmissionStatus.ACCEPTED);
        assertThat(first.username()).isEqualTo("pilot-one");
        assertThat(first.message()).isEqualTo("ready?");
        assertThat(first.recipientPrincipalNames())
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(limited.status()).isEqualTo(MatchService.MatchChatSubmissionStatus.RATE_LIMITED);

        clock.advance(Duration.ofSeconds(5));
        assertThat(service.submitChatMessage(firstUserId, savedMatch.getId(), "after window").status())
                .isEqualTo(MatchService.MatchChatSubmissionStatus.ACCEPTED);
    }

    @Test
    void matchChatRemainsOpenForThirtySecondsAfterTheMatchEnds() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = savedMatch.getId();

        service.surrender(firstUserId);

        assertThat(service.submitChatMessage(firstUserId, matchId, "still here").status())
                .isEqualTo(MatchService.MatchChatSubmissionStatus.ACCEPTED);

        clock.advance(Duration.ofSeconds(30));
        assertThat(service.submitChatMessage(firstUserId, matchId, "too late").status())
                .isEqualTo(MatchService.MatchChatSubmissionStatus.REJECTED);
    }

    @Test
    void closingMatchChatReturnsTheNoticeRecipientsAndRejectsLaterMessages() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = savedMatch.getId();

        service.surrender(firstUserId);

        MatchService.MatchChatClosure closure = service.closeMatchChat(matchId);

        assertThat(closure.message()).isEqualTo("Match chat is now closed.");
        assertThat(closure.recipientPrincipalNames())
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(service.submitChatMessage(firstUserId, matchId, "after close").status())
                .isEqualTo(MatchService.MatchChatSubmissionStatus.REJECTED);
    }

    @Test
    void repeatedSurrenderDoesNotCompleteOrScoreMatchTwice() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        service.surrender(firstUserId);
        List<MatchService.OutboundMatchmakingEvent> retryEvents = service.surrender(firstUserId);

        assertThat(retryEvents).isEmpty();
        verify(matchRepository, times(2)).save(any(Match.class));
        verify(profileRepository, times(2)).save(any());
    }

    @Test
    void repeatedFinishWithSameSubmissionDoesNotAttachTwice() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID submissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, submissionId);

        service.markFinished(firstUserId, submissionId);
        List<MatchService.OutboundMatchmakingEvent> retryEvents =
                service.markFinished(firstUserId, submissionId);

        assertThat(retryEvents).isEmpty();
        verify(botSubmissionRepository, times(1)).findByIdAndUserId(submissionId, firstUserId);
    }

    private void stubSubmission(UUID userId, UUID submissionId) {
        stubSubmission(userId, submissionId, "{}");
    }

    private void stubSubmission(UUID userId, UUID submissionId, String brainPayload) {
        BotSubmission submission = new BotSubmission();
        submission.setId(submissionId);
        submission.setUser(user(userId));
        submission.setBrainSchemaVersion("bot-logic-tree-v1");
        submission.setMatchId(savedMatch.getId());
        submission.setBrainPayload(brainPayload);
        submission.setSelectedLoadout("melee");
        submission.setStatus(BotSubmissionStatus.VALIDATED);
        persistedSubmissions.put(submissionId, submission);
        when(botSubmissionRepository.findByIdAndUserId(eq(submissionId), eq(userId)))
                .thenReturn(Optional.of(submission));
    }

    private int loadoutAbilityCodeCount(String selectedLoadout) {
        return loadoutAbilityCodes(selectedLoadout).length();
    }

    private String loadoutAbilityCodes(String selectedLoadout) {
        return selectedLoadout == null ? "" : selectedLoadout.split(":", -1)[1];
    }

    private MatchPlaybackDTO preparationPlayback(MatchSession session) {
        List<MatchPlaybackDTO.BotStateDTO> bots = session.players().stream()
                .map(player -> new MatchPlaybackDTO.BotStateDTO(
                        player.userId(),
                        player.username(),
                        player.slot(),
                        player.slot() == 1 ? 500.0 : 500.0,
                        player.slot() == 1 ? 150.0 : 850.0,
                        player.slot() == 1 ? 180.0 : 0.0,
                        100,
                        100,
                        "melee",
                        List.of(),
                        0, 0, 0, 0, 0, 0,
                        Map.of(), Map.of(), Map.of(), Map.of(),
                        null, null, 0, 0, 0, 0,
                        player.slot() == 1 ? 500.0 : 500.0,
                        player.slot() == 1 ? 150.0 : 850.0,
                        0))
                .toList();
        return new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "PREPARING",
                new MatchPlaybackDTO.ArenaStateDTO(1000, 1000, bots, List.of()),
                List.of(),
                null,
                null,
                "Preparing the authoritative round replay.");
    }

    private AppUser user(UUID userId) {
        AppUser user = new AppUser();
        user.setId(userId);
        user.setUsername("pilot");
        user.setEmail(userId + "@example.com");
        user.setNormalizedEmail(userId + "@example.com");
        return user;
    }

    private static final class AutoAcceptingMatchmakingService extends MatchmakingService {
        private UUID queuedUserId;

        private AutoAcceptingMatchmakingService(
                MatchService matchService,
                Clock clock,
                MatchmakingRateLimiter matchmakingRateLimiter) {
            super(matchService, clock, matchmakingRateLimiter);
        }

        @Override
        public synchronized List<MatchService.OutboundMatchmakingEvent> joinQueue(
                UUID userId,
                String username,
                String principalName,
                String socketSessionId) {
            List<MatchService.OutboundMatchmakingEvent> events = super.joinQueue(
                    userId,
                    username,
                    principalName,
                    socketSessionId);
            if (events.size() != 2
                    || !"MATCH_FOUND".equals(events.getFirst().event().type())
                    || !"MATCH_ACCEPT".equals(events.getFirst().event().status())) {
                if (events.size() == 1 && "QUEUE_WAITING".equals(events.getFirst().event().type())) {
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

    private static final class MutableClock extends Clock {
        private Instant instant;
        private final ZoneId zone;

        private MutableClock(Instant instant, ZoneId zone) {
            this.instant = instant;
            this.zone = zone;
        }

        private void advance(Duration duration) {
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
