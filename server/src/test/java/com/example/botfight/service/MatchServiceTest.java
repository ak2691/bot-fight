package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchCodeViewResponseDTO;
import com.example.botfight.DTO.MatchmakingEventDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchMode;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.MatchStatus;
import com.example.botfight.domain.BotSubmission;
import com.example.botfight.domain.BotSubmissionStatus;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.MatchService;
import com.example.botfight.service.match.connection.MatchConnectionService;
import com.example.botfight.service.match.persistence.MatchPersistenceService;
import com.example.botfight.service.match.model.*;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.simulation.MatchSimulationService;
import com.example.botfight.service.match.replay.ReplayDeliveryMode;
import com.example.botfight.service.matchmaking.MatchmakingService;
import com.example.botfight.service.limits.RateLimitExceededException;
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
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-06-03T12:00:00Z"), ZoneOffset.UTC);
    private final List<MatchSession> simulatedSessions = new ArrayList<>();
    private final List<MatchParticipant> participants = new ArrayList<>();
    private final Map<UUID, BotSubmission> persistedSubmissions = new HashMap<>();

    private Match savedMatch;
    private MatchService service;
    private MatchmakingService matchmakingService;

    private MatchService createService(ReplayDeliveryMode replayDeliveryMode) {
        return new MatchService(
                simulationService,
                new MatchPersistenceService(
                        matchRepository,
                        matchParticipantRepository,
                        profileRepository,
                        userRepository,
                        clock,
                        new tools.jackson.databind.json.JsonMapper()),
                new MatchConnectionService(clock),
                clock,
                replayDeliveryMode,
                new TokenBucketRateLimiter<>(clock, 10, Duration.ofSeconds(1)));
    }

    @BeforeEach
    void setUp() {
        service = createService(ReplayDeliveryMode.BATCHED);
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
            MatchPlayer winner = session.players().stream()
                    .filter(player -> player.slot() == 2)
                    .findFirst()
                    .orElseThrow();
            return MatchReplayDTO.from(new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    List.of(),
                    "BOT_WIN",
                    winner.userId(),
                    (winner.teamNumber() == 2 ? "Red Team" : "Blue Team") + " wins."));
        });
    }

    @Test
    void startsLoadoutSelectionWithQueueGuarantees() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        List<OutboundMatchmakingEvent> started = service.startMatch(
                new MatchEntrant(
                        firstUserId,
                        "alpha-one",
                        "alpha-one@example.com",
                        null,
                        0,
                        Map.of(1, 1, 2, 6, 3, 21)),
                new MatchEntrant(
                        secondUserId,
                        "alpha-two",
                        "alpha-two@example.com",
                        null,
                        0,
                        Map.of(1, 3, 2, 8, 3, 22)));

        assertThat(started)
                .allMatch(event -> "LOADOUT_SELECT".equals(event.event().status()))
                .allMatch(service::isCurrentEvent);
        assertThat(Duration.between(
                started.getFirst().event().serverNow(),
                started.getFirst().event().loadoutSelectionEndsAt()).getSeconds())
                .isEqualTo(62);

        MatchmakingEventDTO firstStarted = started.stream()
                .filter(event -> firstUserId.equals(event.event().player().userId()))
                .findFirst()
                .orElseThrow()
                .event();
        MatchmakingEventDTO secondStarted = started.stream()
                .filter(event -> secondUserId.equals(event.event().player().userId()))
                .findFirst()
                .orElseThrow()
                .event();
        assertThat(firstStarted.abilityOffers()).hasSize(6).contains(1).doesNotContain(3);
        assertThat(secondStarted.abilityOffers()).hasSize(6).contains(3).doesNotContain(1);
    }

    @Test
    void blockedTransitionInOneMatchDoesNotBlockAnotherMatch() throws Exception {
        UUID firstMatchFirstUser = UUID.randomUUID();
        UUID firstMatchSecondUser = UUID.randomUUID();
        UUID secondMatchFirstUser = UUID.randomUUID();
        UUID secondMatchSecondUser = UUID.randomUUID();
        UUID firstMatchId = service.startMatch(
                        new MatchEntrant(firstMatchFirstUser, "alpha-one", "alpha-one@example.com", null),
                        new MatchEntrant(firstMatchSecondUser, "alpha-two", "alpha-two@example.com", null))
                .getFirst().event().matchId();
        UUID secondMatchId = service.startMatch(
                        new MatchEntrant(secondMatchFirstUser, "beta-one", "beta-one@example.com", null),
                        new MatchEntrant(secondMatchSecondUser, "beta-two", "beta-two@example.com", null))
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
            Future<List<OutboundMatchmakingEvent>> blockedFirstMatch =
                    executor.submit(() -> service.selectLoadout(firstMatchSecondUser, "melee"));
            assertThat(firstMatchEnteredBlockedWork.await(2, TimeUnit.SECONDS)).isTrue();

            Future<List<OutboundMatchmakingEvent>> independentSecondMatch =
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
    void staleSelectionSnapshotIsRejectedAfterTheMatchEntersBuilding() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        List<OutboundMatchmakingEvent> started = matchmakingService.joinQueue(
                firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<OutboundMatchmakingEvent> selectionEvents = service.selectLoadout(firstUserId, "melee");
        List<OutboundMatchmakingEvent> buildingEvents = service.selectLoadout(secondUserId, "melee");

        assertThat(started).isNotEmpty();
        assertThat(selectionEvents).hasSize(2);
        assertThat(buildingEvents).hasSize(2);
        assertThat(selectionEvents).allSatisfy(event ->
                assertThat(service.isCurrentEvent(event)).isFalse());
        assertThat(buildingEvents).allSatisfy(event ->
                assertThat(service.isCurrentEvent(event)).isTrue());
        assertThat(Duration.between(clock.instant(), buildingEvents.get(0).event().buildingEndsAt()))
                .isEqualTo(Duration.ofSeconds(302));
    }

    @Test
    void resumingDuringSecondRoundBuildingUsesTheLivePhaseInsteadOfTheReplayBoundary() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";

        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        List<OutboundMatchmakingEvent> firstRoundEvents = service.completeSimulation(savedMatch.getId());
        Instant secondRoundReadyAt = firstRoundEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), secondRoundReadyAt));
        firstRoundEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .forEach(service::activateRoundLoadoutSelection);

        service.selectLoadout(firstUserId, "melee");
        List<OutboundMatchmakingEvent> buildingEvents = service.selectLoadout(secondUserId, "melee");
        assertThat(buildingEvents).allSatisfy(event ->
                assertThat(event.event().roundNumber()).isEqualTo(2));

        OutboundMatchmakingEvent staleBoundary = firstRoundEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .findFirst()
                .orElseThrow();
        assertThat(service.activateRoundLoadoutSelection(staleBoundary))
                .as("a delayed round boundary cannot reopen loadout selection")
                .isNull();

        List<OutboundMatchmakingEvent> resumed = service.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-reconnected");

        assertThat(resumed).singleElement().satisfies(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_FOUND");
            assertThat(event.event().status()).isEqualTo("PREP");
            assertThat(event.event().roundNumber()).isEqualTo(2);
            assertThat(event.event().buildingEndsAt()).isNotNull();
            assertThat(service.isCurrentEvent(event)).isTrue();
        });
    }

    @Test
    void disconnectNotificationRemainsCurrentAcrossLoadoutToBuildingTransition() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        service.selectLoadout(firstUserId, "melee");
        List<OutboundMatchmakingEvent> disconnectEvents = service.markDisconnected(firstPrincipal);
        assertThat(disconnectEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("PLAYER_DISCONNECTED");
            assertThat(event.event().status()).isEqualTo("LOADOUT_SELECT");
            assertThat(service.isCurrentEvent(event)).isTrue();
        });

        service.selectLoadout(secondUserId, "melee");

        assertThat(disconnectEvents).allSatisfy(event ->
                assertThat(service.isCurrentEvent(event)).isTrue());
    }

    @Test
    void loadoutRequestFromAnOlderRoundIsIgnored() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID matchId = service.startMatch(
                        new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null),
                        new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null))
                .getFirst().event().matchId();

        assertThat(service.selectLoadout(firstUserId, matchId, 2, "melee")).isEmpty();
        assertThat(service.selectLoadout(firstUserId, matchId, 1, "melee")).isNotEmpty();
    }

    @Test
    void teamMatchStartsOnlyWithAnExactTwoVersusTwoRoster() {
        List<MatchEntrant> entrants = List.of(
                new MatchEntrant(UUID.randomUUID(), "team-one-a", "team-one-a@example.com", "socket-1", 1),
                new MatchEntrant(UUID.randomUUID(), "team-one-b", "team-one-b@example.com", "socket-2", 1),
                new MatchEntrant(UUID.randomUUID(), "team-two-a", "team-two-a@example.com", "socket-3", 2),
                new MatchEntrant(UUID.randomUUID(), "team-two-b", "team-two-b@example.com", "socket-4", 2));

        List<OutboundMatchmakingEvent> events = service.startTeamMatch(entrants, MatchMode.TWOS);

        assertThat(events).hasSize(4);
        assertThat(events).allSatisfy(event -> assertThat(event.event().players()).hasSize(4));
    }

    @Test
    void malformedTeamRosterAndDuplicateSocketAreRejectedBeforePersistence() {
        List<MatchEntrant> threePlayers = List.of(
                new MatchEntrant(UUID.randomUUID(), "team-one-a", "team-one-a@example.com", "socket-1", 1),
                new MatchEntrant(UUID.randomUUID(), "team-one-b", "team-one-b@example.com", "socket-2", 1),
                new MatchEntrant(UUID.randomUUID(), "team-two-a", "team-two-a@example.com", "socket-3", 2));

        assertThatThrownBy(() -> service.startTeamMatch(threePlayers, MatchMode.TWOS))
                .isInstanceOf(AuthException.class)
                .hasMessage("2v2 matches require exactly two players on each team");

        List<MatchEntrant> duplicateSockets = List.of(
                new MatchEntrant(UUID.randomUUID(), "team-one-a", "team-one-a@example.com", "same-socket", 1),
                new MatchEntrant(UUID.randomUUID(), "team-one-b", "team-one-b@example.com", "same-socket", 1),
                new MatchEntrant(UUID.randomUUID(), "team-two-a", "team-two-a@example.com", "socket-3", 2),
                new MatchEntrant(UUID.randomUUID(), "team-two-b", "team-two-b@example.com", "socket-4", 2));

        assertThatThrownBy(() -> service.startTeamMatch(duplicateSockets, MatchMode.TWOS))
                .isInstanceOf(AuthException.class)
                .hasMessage("match players must use distinct socket connections");
    }

    @Test
    void codeViewUsesAOneShotReadOnlySnapshotAndPerRequesterRateLimit() {
        UUID requesterId = UUID.randomUUID();
        UUID teammateUserId = UUID.randomUUID();
        UUID opponentUserId = UUID.randomUUID();
        UUID opponentTwoUserId = UUID.randomUUID();
        service.startTeamMatch(List.of(
                new MatchEntrant(requesterId, "pilot-one", "pilot-one@example.com", "socket-one", 1),
                new MatchEntrant(teammateUserId, "pilot-teammate", "pilot-teammate@example.com", "socket-two", 1),
                new MatchEntrant(opponentUserId, "pilot-two", "pilot-two@example.com", "socket-three", 2),
                new MatchEntrant(opponentTwoUserId, "pilot-two-b", "pilot-two-b@example.com", "socket-four", 2)), MatchMode.TWOS);
        UUID matchId = savedMatch.getId();

        assertThatThrownBy(() -> service.requestCodeView(
                requesterId, matchId, opponentUserId, 1))
                .isInstanceOf(AuthException.class)
                .hasMessage("you can only view real code from a teammate");

        OutboundMatchmakingEvent request = service.requestCodeView(
                requesterId, matchId, teammateUserId, 1);

        assertThat(request.principalName()).isEqualTo("pilot-teammate@example.com");
        assertThat(request.event().type()).isEqualTo("MATCH_CODE_VIEW_REQUEST");
        assertThat(request.event().codeViewRequestId()).isNotNull();
        assertThat(request.event().codeViewTargetUserId()).isEqualTo(teammateUserId);

        tools.jackson.databind.JsonNode brain = new tools.jackson.databind.json.JsonMapper()
                .createObjectNode()
                .put("version", "bot-logic-tree-v1");
        OutboundMatchmakingEvent result = service.respondCodeView(
                teammateUserId,
                new MatchCodeViewResponseDTO(
                        request.event().codeViewRequestId(),
                        matchId,
                        teammateUserId,
                        1,
                        brain,
                        "melee"));

        assertThat(result.principalName()).isEqualTo("pilot-one@example.com");
        assertThat(result.event().type()).isEqualTo("MATCH_CODE_VIEW_RESULT");
        assertThat(result.event().codeViewTargetUserId()).isEqualTo(teammateUserId);
        assertThat(result.event().codeViewBrain()).isEqualTo(brain);
        assertThat(result.event().codeViewSelectedLoadout()).isEqualTo("melee");

        assertThatThrownBy(() -> service.requestCodeView(requesterId, matchId, teammateUserId, 1))
                .isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    void duplicateLoadoutSelectionIsIdempotentUnderTheMatchLock() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        service.startMatch(
                new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null),
                new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null));

        service.selectLoadout(firstUserId, "melee");
        List<OutboundMatchmakingEvent> duplicate =
                service.selectLoadout(firstUserId, "ranged");

        assertThat(duplicate).hasSize(1);
        assertThat(duplicate.getFirst().event().player().loadoutSelected()).isTrue();
        assertThat(duplicate.getFirst().event().player().selectedLoadout()).isEqualTo("melee");
        assertThat(service.selectLoadout(secondUserId, "melee")).hasSize(2);
    }

    @Test
    void matchSubmissionRetryUsesTheInMemoryRoundKeyWithoutSubmissionLookup() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID matchId = service.startMatch(
                        new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", null),
                        new MatchEntrant(secondUserId, "pilot-two", "pilot-two@example.com", null))
                .getFirst().event().matchId();
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");

        MatchSubmissionResult first = service.acceptMatchSubmission(
                firstUserId,
                matchId,
                1,
                "BUILDING",
                inMemorySubmission(matchId, "fingerprint-1"));
        MatchSubmissionResult retry = service.acceptMatchSubmission(
                firstUserId,
                matchId,
                1,
                "BUILDING",
                inMemorySubmission(matchId, "fingerprint-1"));

        assertThat(first.accepted()).isTrue();
        assertThat(first.duplicate()).isFalse();
        assertThat(retry.accepted()).isTrue();
        assertThat(retry.duplicate()).isTrue();
    }

    @Test
    void ratedReplayStreamsTheAuthoritativeResultWithTheBufferedTerminalFrame() {
        List<String> preparationSteps = new ArrayList<>();
        List<Integer> authoritativeElapsedMs = new ArrayList<>();
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            preparationSteps.add("simulation");
            MatchSession session = invocation.getArgument(0);
            MatchPlayer winner = session.players().getLast();
            MatchPlaybackDTO.ArenaStateDTO state =
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of());
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
            for (int elapsedMs = 0, tick = 0; elapsedMs <= 50_500; elapsedMs += 100, tick++) {
                authoritativeElapsedMs.add(elapsedMs);
                frames.add(new MatchPlaybackDTO.ReplayFrameDTO(tick, elapsedMs, List.of(), List.of()));
            }
            return MatchReplayDTO.from(new MatchPlaybackDTO(
                    session.matchId(), MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED", state, frames, "BOT_WIN", winner.userId(), "winner"));
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
        submitMatch(firstUserId, firstSubmissionId);

        List<OutboundMatchmakingEvent> preparingEvents =
                submitMatch(secondUserId, secondSubmissionId);
        assertThat(preparingEvents).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo("SIMULATION_LOADING"));
        assertThat(preparingEvents).allSatisfy(outbound ->
                assertThat(outbound.event().playbackStartsAt()).isNull());
        assertThat(simulatedSessions).isEmpty();
        clock.advance(Duration.ofSeconds(7));
        List<OutboundMatchmakingEvent> events =
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
                    assertThat(outbound.event().playback().roundWinsBeforeResult())
                            .containsEntry(firstUserId, 0)
                            .containsEntry(secondUserId, 0);
                    assertThat(outbound.delayMillis()).isZero();
                    assertThat(outbound.publishAt()).isNull();
                });
        List<OutboundMatchmakingEvent> replayBatches = events.stream()
                .filter(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .filter(outbound -> outbound.event().type().equals("MATCH_REPLAY_BATCH"))
                .toList();
        List<OutboundMatchmakingEvent> replayFrameBatches = replayBatches.stream()
                .filter(outbound -> !outbound.event().playback().frames().isEmpty())
                .toList();
        assertThat(replayFrameBatches).isNotEmpty();
        assertThat(replayFrameBatches.getFirst().delayMillis()).isEqualTo(2_000L);
        assertThat(replayFrameBatches.getFirst().publishAt()).isEqualTo(clock.instant().plusSeconds(2));
        assertThat(replayFrameBatches.getFirst().event().playback().frames().getLast().elapsedMs())
                .isEqualTo(1_000);
        assertThat(replayFrameBatches.getLast().delayMillis()).isEqualTo(51_500L);
        assertThat(replayFrameBatches.getLast().publishAt()).isEqualTo(clock.instant().plusMillis(51_500));
        assertThat(replayFrameBatches.getLast().event().playback().terminalBatch()).isTrue();
        assertThat(replayFrameBatches.getLast().event().playback().frames().getLast().elapsedMs())
                .isEqualTo(50_500);
        assertThat(replayFrameBatches).allSatisfy(outbound -> {
            assertThat(outbound.event().playback().result()).isNull();
            assertThat(outbound.event().playback().winnerUserId()).isNull();
            assertThat(outbound.event().playback().message()).isNull();
        });
        assertThat(replayBatches)
                .filteredOn(outbound -> outbound.event().playback().frames().isEmpty())
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("ROUND_RESULT_READY");
                    assertThat(outbound.delayMillis()).isEqualTo(53_500L);
                    assertThat(outbound.publishAt()).isEqualTo(clock.instant().plusMillis(53_500));
                    assertThat(outbound.event().playback().result()).isEqualTo("BOT_WIN");
                    assertThat(outbound.event().playback().winnerUserId()).isNotNull();
                });
        assertThat(replayBatches.stream()
                .flatMap(outbound -> outbound.event().playback().frames().stream())
                .map(MatchReplayDTO.ReplayFrameDTO::elapsedMs)
                .toList()).containsExactlyElementsOf(authoritativeElapsedMs);
        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.delayMillis()).isEqualTo(56_500L);
                    assertThat(outbound.event().resultRevealsAt())
                            .isEqualTo(clock.instant().plusMillis(53_500));
                    assertThat(outbound.event().roundReadyAt())
                            .isEqualTo(clock.instant().plusMillis(56_500));
                    assertThat(Duration.between(
                            outbound.event().resultRevealsAt(),
                            outbound.event().roundReadyAt())).isEqualTo(Duration.ofSeconds(3));
                    assertThat(outbound.publishAt()).isEqualTo(outbound.event().roundReadyAt());
                    assertThat(outbound.event().loadoutSelectionEndsAt()).isNull();
                });
        assertThat(service.selectLoadout(firstUserId, "melee")).isEmpty();
        assertThat(service.selectLoadout(secondUserId, "melee")).isEmpty();
        assertThat(service.resolveLoadoutSelectionTimeout(savedMatch.getId()))
                .as("a stale prior-round timeout cannot advance a round whose selection is not active")
                .isEmpty();
        List<OutboundMatchmakingEvent> activatedRoundEvents = events.stream()
                .filter(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .map(service::activateRoundLoadoutSelection)
                .toList();
        assertThat(activatedRoundEvents).allSatisfy(outbound ->
                assertThat(outbound.event().loadoutSelectionEndsAt())
                        .isEqualTo(clock.instant().plusSeconds(62)));
        assertThat(service.matchChatCloseAt(savedMatch.getId())).isNull();
    }

    @Test
    void singlePlayerForfeitDuringReplayCompletesAOneVersusOneMatch() {
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
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        assertThat(service.completeSimulation(savedMatch.getId())).isNotEmpty();

        List<OutboundMatchmakingEvent> events = service.surrender(firstUserId);

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().roundNumber()).isEqualTo(1);
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
            assertThat(outbound.event().playback().message()).isEqualTo("Red Team wins.");
            assertThat(outbound.delayMillis()).isZero();
        });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
        assertThat(service.surrender(firstUserId)).isEmpty();
    }

    @Test
    void fullReplayModeSendsEveryFrameInOneImmediatePayload() {
        service = createService(ReplayDeliveryMode.FULL);
        matchmakingService = new AutoAcceptingMatchmakingService(
                service,
                clock,
                new TokenBucketRateLimiter<>(clock, 3, Duration.ofSeconds(3)));
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            UUID winnerUserId = session.players().getFirst().userId();
            MatchPlaybackDTO.ArenaStateDTO state =
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of());
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = List.of(
                    new MatchPlaybackDTO.ReplayFrameDTO(0, 0, List.of(), List.of()),
                    new MatchPlaybackDTO.ReplayFrameDTO(10, 1_000, List.of(), List.of()),
                    new MatchPlaybackDTO.ReplayFrameDTO(20, 2_000, List.of(), List.of()));
            return MatchReplayDTO.from(new MatchPlaybackDTO(
                    session.matchId(), MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED", state, frames, "BOT_WIN", winnerUserId, "winner"));
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
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        List<OutboundMatchmakingEvent> replayEvents =
                service.completeSimulation(savedMatch.getId()).stream()
                        .filter(event -> event.principalName().equals("pilot-one@example.com"))
                        .filter(event -> event.event().type().equals("MATCH_REPLAY_BATCH"))
                        .toList();

        assertThat(replayEvents)
                .filteredOn(event -> !event.event().playback().frames().isEmpty())
                .singleElement()
                .satisfies(event -> {
            assertThat(event.delayMillis()).isZero();
            assertThat(event.event().playback().frames())
                    .extracting(MatchReplayDTO.ReplayFrameDTO::elapsedMs)
                    .containsExactly(0, 1_000, 2_000);
            assertThat(event.event().playback().initialState()).isNotNull();
            assertThat(event.event().playback().replayCursorElapsedMs()).isEqualTo(2_000);
            assertThat(event.event().playback().terminalBatch()).isTrue();
            assertThat(event.event().playback().result()).isNull();
            assertThat(event.event().playback().winnerUserId()).isNull();
            assertThat(event.event().playback().message()).isNull();
        });
        assertThat(replayEvents)
                .filteredOn(event -> event.event().playback().frames().isEmpty())
                .singleElement()
                .satisfies(event -> {
                    assertThat(event.delayMillis()).isEqualTo(5_000L);
                    assertThat(event.event().playback().result()).isEqualTo("BOT_WIN");
                    assertThat(event.event().playback().winnerUserId()).isNotNull();
                });
    }

    @Test
    void terminalReplayStaysReplayCurrentAndRevealsResultWithAnExplicitDelayedEvent() {
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            MatchPlayer winner = session.players().getLast();
            return MatchReplayDTO.from(new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    List.of(new MatchPlaybackDTO.ReplayFrameDTO(10, 1_000, List.of(), List.of())),
                    "BOT_WIN",
                    winner.userId(),
                    "winner"));
        });
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        String secondPrincipal = "pilot-two@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", secondPrincipal);
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        submitMatch(firstUserId, firstRoundFirstSubmission);
        submitMatch(secondUserId, firstRoundSecondSubmission);
        List<OutboundMatchmakingEvent> firstRoundEvents = service.completeSimulation(savedMatch.getId());
        List<OutboundMatchmakingEvent> roundReadyEvents = firstRoundEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .toList();
        Instant secondRoundReadyAt = roundReadyEvents.getFirst().event().roundReadyAt();
        clock.advance(Duration.between(clock.instant(), secondRoundReadyAt));
        roundReadyEvents.forEach(service::activateRoundLoadoutSelection);

        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        UUID secondRoundFirstSubmission = UUID.randomUUID();
        UUID secondRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, secondRoundFirstSubmission);
        stubSubmission(secondUserId, secondRoundSecondSubmission);
        submitMatch(firstUserId, secondRoundFirstSubmission);
        submitMatch(secondUserId, secondRoundSecondSubmission);

        List<OutboundMatchmakingEvent> terminalEvents = service.completeSimulation(savedMatch.getId());
        List<OutboundMatchmakingEvent> preparingEvents = terminalEvents.stream()
                .filter(event -> "SIMULATION_PREPARING".equals(event.event().type()))
                .toList();
        List<OutboundMatchmakingEvent> resultEvents = terminalEvents.stream()
                .filter(event -> "MATCH_RESULT_READY".equals(event.event().type()))
                .toList();

        assertThat(preparingEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.delayMillis()).isZero();
            assertThat(service.isCurrentEvent(event)).isTrue();
        });
        assertThat(resultEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.delayMillis()).isEqualTo(4_000L);
            assertThat(event.event().playback().result()).isEqualTo("BOT_WIN");
            assertThat(event.event().playback().frames()).isEmpty();
        });
        assertThat(terminalEvents)
                .noneMatch(event -> "MATCH_ROUND_READY".equals(event.event().type()));

        Instant resultRevealsAt = resultEvents.getFirst().event().resultRevealsAt();
        UUID terminalWinnerUserId = resultEvents.getFirst().event().playback().winnerUserId();
        assertThat(service.markDisconnected(firstPrincipal)).isEmpty();
        assertThat(service.activeMatchStatus(firstUserId).disconnected()).isFalse();
        clock.advance(Duration.between(clock.instant(), resultRevealsAt).plusMillis(1));

        assertThat(service.resumeMatch(firstUserId, "pilot-one", firstPrincipal, "socket-reconnected"))
                .anySatisfy(event -> assertThat(event.event().type()).isEqualTo("NO_ACTIVE_MATCH"));
        assertThat(service.activeMatchStatus(firstUserId).activeMatch()).isFalse();
        assertThat(service.activeMatchStatus(secondUserId).activeMatch())
                .as("the terminal session remains hidden from active-match checks")
                .isFalse();
        assertThat(service.submitChatMessage(firstUserId, savedMatch.getId(), "chat remains available").status())
                .isEqualTo(MatchChatSubmissionStatus.ACCEPTED);
        assertThat(terminalWinnerUserId).isEqualTo(resultEvents.getFirst().event().playback().winnerUserId());
    }

    @Test
    void replayDisconnectWaitsForAValidNextRoundBeforeStartingGrace() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        List<OutboundMatchmakingEvent> replayEvents = service.completeSimulation(savedMatch.getId());
        Instant roundReadyAt = replayEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();

        assertThat(service.markDisconnected(firstPrincipal)).isEmpty();
        assertThat(service.activeMatchStatus(firstUserId).disconnected()).isFalse();

        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        replayEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .forEach(service::activateRoundLoadoutSelection);

        List<OutboundMatchmakingEvent> disconnectEvents =
                service.promotePendingDisconnect(firstPrincipal);
        assertThat(disconnectEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("PLAYER_DISCONNECTED");
            assertThat(event.event().disconnectEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });

        List<OutboundMatchmakingEvent> reconnectEvents =
                service.resumeMatch(firstUserId, "pilot-one", firstPrincipal, "socket-reconnected");
        assertThat(reconnectEvents)
                .filteredOn(event -> "PLAYER_RECONNECTED".equals(event.event().type()))
                .hasSize(2)
                .allSatisfy(event -> assertThat(service.isCurrentEvent(event)).isTrue());

        service.selectLoadout(firstUserId, "melee");
        List<OutboundMatchmakingEvent> buildingEvents = service.selectLoadout(secondUserId, "melee");
        assertThat(buildingEvents)
                .filteredOn(event -> "BOT_BUILDING_SESSION_READY".equals(event.event().type()))
                .hasSize(2);

        List<OutboundMatchmakingEvent> buildingDisconnectEvents = service.markDisconnected(firstPrincipal);
        assertThat(buildingDisconnectEvents).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("PLAYER_DISCONNECTED");
            assertThat(event.event().status()).isEqualTo("PREP");
            assertThat(service.isCurrentEvent(event)).isTrue();
        });
    }

    @Test
    void startedDisconnectGracePausesDuringReplayAndStartsFreshGracePeriod() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);

        service.markDisconnected(firstPrincipal);
        clock.advance(Duration.ofSeconds(18));
        List<OutboundMatchmakingEvent> replayEvents = service.completeSimulation(savedMatch.getId());
        assertThat(service.activeMatchStatus(firstUserId).disconnected()).isFalse();
        assertThat(replayEvents)
                .filteredOn(event -> "SIMULATION_PREPARING".equals(event.event().type()))
                .allSatisfy(event -> assertThat(event.event().disconnectEndsAt()).isNull());

        Instant roundReadyAt = replayEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        replayEvents.stream()
                .filter(event -> "MATCH_ROUND_READY".equals(event.event().type()))
                .forEach(service::activateRoundLoadoutSelection);

        List<OutboundMatchmakingEvent> resumedEvents =
                service.promotePendingDisconnect(firstPrincipal);
        Instant resumedDeadline = resumedEvents.getFirst().event().disconnectEndsAt();
        assertThat(resumedDeadline).isEqualTo(clock.instant().plusSeconds(30));

        clock.advance(Duration.between(clock.instant(), resumedDeadline));
        List<OutboundMatchmakingEvent> results = service.resolveDisconnectTimeout(
                firstPrincipal,
                resumedDeadline);

        assertThat(results).hasSize(2).allSatisfy(event -> {
            assertThat(event.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(event.event().playback().result()).isEqualTo("DISCONNECTION_WIN");
            assertThat(event.event().playback().winnerUserId()).isEqualTo(secondUserId);
        });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("DISCONNECTION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Test
    void terminalSeriesCompletionWinsTheDisconnectRaceAndStartsNoNewGracePeriod() {
        when(simulationService.buildDuelReplay(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            MatchPlayer winner = session.players().getLast();
            return MatchReplayDTO.from(new MatchPlaybackDTO(
                    session.matchId(),
                    MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    List.of(),
                    "BOT_WIN",
                    winner.userId(),
                    "winner"));
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
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);
        List<OutboundMatchmakingEvent> roundEvents =
                service.completeSimulation(savedMatch.getId());
        Instant roundReadyAt = roundEvents.stream()
                .filter(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        roundEvents.stream()
                .filter(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .forEach(service::activateRoundLoadoutSelection);
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
        clock.advance(Duration.between(clock.instant(), deadline));
        List<OutboundMatchmakingEvent> results =
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
        submitMatch(firstUserId, firstSubmissionId);
        submitMatch(secondUserId, secondSubmissionId);
        List<OutboundMatchmakingEvent> firstRoundEvents = service.completeSimulation(savedMatch.getId());
        Instant roundReadyAt = firstRoundEvents.stream()
                .filter(outbound -> "MATCH_ROUND_READY".equals(outbound.event().type()))
                .findFirst()
                .orElseThrow()
                .event()
                .roundReadyAt();
        clock.advance(Duration.between(clock.instant(), roundReadyAt));
        firstRoundEvents.stream()
                .filter(outbound -> "MATCH_ROUND_READY".equals(outbound.event().type()))
                .forEach(service::activateRoundLoadoutSelection);

        Instant firstDeadline =
                service.markDisconnected(firstPrincipal).getFirst().event().disconnectEndsAt();
        service.markDisconnected(secondPrincipal);
        clock.advance(Duration.between(clock.instant(), firstDeadline));
        List<OutboundMatchmakingEvent> results =
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

        List<OutboundMatchmakingEvent> reconnectEvents =
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
        List<OutboundMatchmakingEvent> notices =
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

        List<OutboundMatchmakingEvent> firstNotice =
                service.markDisconnected(firstPrincipal, "socket-one");
        clock.advance(Duration.ofSeconds(1));
        List<OutboundMatchmakingEvent> duplicateNotice =
                service.markDisconnected(firstPrincipal, "socket-one");

        assertThat(firstNotice).hasSize(2);
        assertThat(duplicateNotice).isEmpty();
        assertThat(firstNotice.getFirst().event().disconnectEndsAt())
                .isEqualTo(Instant.parse("2026-06-03T12:00:30Z"));
    }

    @Test
    void unanimousTeamForfeitCompletesMatchForTheOpposingTeam() {
        UUID firstUserId = UUID.randomUUID();
        UUID teammateUserId = UUID.randomUUID();
        UUID opponentUserId = UUID.randomUUID();
        UUID opponentTeammateUserId = UUID.randomUUID();
        service.startTeamMatch(List.of(
                new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", "socket-one", 1),
                new MatchEntrant(teammateUserId, "pilot-one-b", "pilot-one-b@example.com", "socket-two", 1),
                new MatchEntrant(opponentUserId, "pilot-two", "pilot-two@example.com", "socket-three", 2),
                new MatchEntrant(opponentTeammateUserId, "pilot-two-b", "pilot-two-b@example.com", "socket-four", 2)), MatchMode.TWOS);

        List<OutboundMatchmakingEvent> voteEvents = service.surrender(firstUserId);

        assertThat(voteEvents).hasSize(4).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_SURRENDER_UPDATED");
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(2);
            assertThat(outbound.event().surrenderVoteCount())
                    .isEqualTo(outbound.event().player().teamNumber() == 1 ? 1 : 0);
        });
        List<OutboundMatchmakingEvent> events = service.surrender(teammateUserId);

        assertThat(events).hasSize(4);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isIn(opponentUserId, opponentTeammateUserId);
        assertThat(participants)
                .filteredOn(participant -> participant.getTeamNumber() == 1)
                .hasSize(2)
                .allSatisfy(participant ->
                        assertThat(participant.getResult()).isEqualTo(MatchResult.FORFEIT));
        assertThat(participants)
                .filteredOn(participant -> participant.getTeamNumber() == 2)
                .hasSize(2)
                .allSatisfy(participant ->
                        assertThat(participant.getResult()).isEqualTo(MatchResult.WIN));
        assertThat(events).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId())
                    .isIn(opponentUserId, opponentTeammateUserId);
            assertThat(outbound.event().playback().message()).isEqualTo("Red Team wins.");
            assertThat(outbound.delayMillis()).isZero();
            assertThat(outbound.event().matchChatEndsAt()).isEqualTo(clock.instant().plusSeconds(30));
        });
        assertThat(service.matchChatCloseAt(savedMatch.getId()))
                .isEqualTo(clock.instant().plusSeconds(30));
        assertThat(service.markDisconnected("pilot-one@example.com")).isEmpty();
        assertThat(service.markDisconnected("pilot-one-b@example.com")).isEmpty();
        assertThat(savedMatch.getWinnerUser().getId()).isIn(opponentUserId, opponentTeammateUserId);
    }

    @Test
    void oneVersusOneForfeitRequiresOnlyThatTeamMember() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<OutboundMatchmakingEvent> events = service.surrender(firstUserId);

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().result()).isEqualTo("RESIGNATION_WIN");
            assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(1);
        });
        assertThat(savedMatch.getCompletionReason()).isEqualTo("RESIGNATION");
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Test
    void forfeitVoteCanBeWithdrawnBeforeItBecomesUnanimous() {
        UUID firstUserId = UUID.randomUUID();
        UUID teammateUserId = UUID.randomUUID();
        UUID opponentUserId = UUID.randomUUID();
        UUID opponentTeammateUserId = UUID.randomUUID();
        service.startTeamMatch(List.of(
                new MatchEntrant(firstUserId, "pilot-one", "pilot-one@example.com", "socket-one", 1),
                new MatchEntrant(teammateUserId, "pilot-one-b", "pilot-one-b@example.com", "socket-two", 1),
                new MatchEntrant(opponentUserId, "pilot-two", "pilot-two@example.com", "socket-three", 2),
                new MatchEntrant(opponentTeammateUserId, "pilot-two-b", "pilot-two-b@example.com", "socket-four", 2)), MatchMode.TWOS);

        List<OutboundMatchmakingEvent> voteEvents = service.surrender(firstUserId);
        List<OutboundMatchmakingEvent> withdrawalEvents = service.surrender(firstUserId);

        assertThat(voteEvents).hasSize(4).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_SURRENDER_UPDATED");
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(2);
        });
        assertThat(withdrawalEvents).hasSize(4).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_SURRENDER_UPDATED");
            assertThat(outbound.event().surrenderVoteCount()).isZero();
            assertThat(outbound.event().surrenderVoteRequired()).isEqualTo(2);
        });
        assertThat(withdrawalEvents.stream()
                .filter(outbound -> outbound.event().player().userId().equals(firstUserId))
                .findFirst()
                .orElseThrow()
                .event()
                .surrenderRequestedByMe()).isFalse();
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Test
    void matchChatIsServerConfirmedAndRateLimitedPerSender() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        MatchChatSubmission first =
                service.submitChatMessage(firstUserId, savedMatch.getId(), "  ready?  ");
        for (int messageNumber = 2; messageNumber <= 10; messageNumber++) {
            service.submitChatMessage(firstUserId, savedMatch.getId(), "message-" + messageNumber);
        }
        MatchChatSubmission limited =
                service.submitChatMessage(firstUserId, savedMatch.getId(), "message-11");

        assertThat(first.status()).isEqualTo(MatchChatSubmissionStatus.ACCEPTED);
        assertThat(first.username()).isEqualTo("pilot-one");
        assertThat(first.message()).isEqualTo("ready?");
        assertThat(first.recipientPrincipalNames())
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(limited.status()).isEqualTo(MatchChatSubmissionStatus.RATE_LIMITED);
        assertThat(limited.message()).isEqualTo("Too many requests, please wait.");

        clock.advance(Duration.ofSeconds(1));
        assertThat(service.submitChatMessage(firstUserId, savedMatch.getId(), "after window").status())
                .isEqualTo(MatchChatSubmissionStatus.ACCEPTED);
    }

    @Test
    void matchChatRemainsOpenForThirtySecondsAfterTheMatchEnds() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = savedMatch.getId();

        service.surrender(firstUserId);
        service.surrender(secondUserId);

        assertThat(service.submitChatMessage(firstUserId, matchId, "still here").status())
                .isEqualTo(MatchChatSubmissionStatus.ACCEPTED);

        clock.advance(Duration.ofSeconds(30));
        assertThat(service.submitChatMessage(firstUserId, matchId, "too late").status())
                .isEqualTo(MatchChatSubmissionStatus.REJECTED);
    }

    @Test
    void closingMatchChatReturnsTheNoticeRecipientsAndRejectsLaterMessages() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = savedMatch.getId();

        service.surrender(firstUserId);
        service.surrender(secondUserId);

        MatchChatClosure closure = service.closeMatchChat(matchId);

        assertThat(closure.message()).isEqualTo("Match chat is now closed.");
        assertThat(closure.recipientPrincipalNames())
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(service.submitChatMessage(firstUserId, matchId, "after close").status())
                .isEqualTo(MatchChatSubmissionStatus.REJECTED);
    }

    @Test
    void repeatedSurrenderDoesNotCompleteOrScoreMatchTwice() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        service.surrender(firstUserId);
        service.surrender(secondUserId);
        List<OutboundMatchmakingEvent> retryEvents = service.surrender(firstUserId);

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

        submitMatch(firstUserId, submissionId);
        List<OutboundMatchmakingEvent> retryEvents =
                submitMatch(firstUserId, submissionId);

        assertThat(retryEvents).isEmpty();
    }

    private void stubSubmission(UUID userId, UUID submissionId) {
        stubSubmission(userId, submissionId, "{}");
    }

    private BotSubmission inMemorySubmission(UUID matchId, String fingerprint) {
        BotSubmission submission = new BotSubmission();
        submission.setMatchId(matchId);
        submission.setRequestFingerprint(fingerprint);
        submission.setSelectedLoadout("melee");
        submission.setBrainSchemaVersion("bot-logic-tree-v1");
        submission.setBrainPayload("{}");
        submission.setStatus(BotSubmissionStatus.VALIDATED);
        return submission;
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
    }

    private List<OutboundMatchmakingEvent> submitMatch(UUID userId, UUID submissionId) {
        BotSubmission submission = persistedSubmissions.get(submissionId);
        assertThat(submission).isNotNull();
        MatchSubmissionResult result = service.acceptMatchSubmission(
                userId,
                savedMatch.getId(),
                submission);
        assertThat(result.accepted()).isTrue();
        return result.events();
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
                        List.of(),
                        Map.of(), Map.of(), Map.of(), Map.of(),
                        null, null, 0, 0,
                        player.slot() == 1 ? 500.0 : 500.0,
                        player.slot() == 1 ? 150.0 : 850.0,
                        0, 0))
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
                TokenBucketRateLimiter<UUID> matchmakingRateLimiter) {
            super(matchService, clock, matchmakingRateLimiter);
        }

        @Override
        public synchronized List<OutboundMatchmakingEvent> joinQueue(
                UUID userId,
                String username,
                String principalName,
                String socketSessionId) {
            List<OutboundMatchmakingEvent> events = super.joinQueue(
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
