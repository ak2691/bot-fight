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
    private final List<MatchPlaybackDTO.ObstaclePlacementDTO> matchObstacles = List.of(
            new MatchPlaybackDTO.ObstaclePlacementDTO("object_center", "radarJammer", 400.0, 400.0, 92),
            new MatchPlaybackDTO.ObstaclePlacementDTO("object_buff_1", "overdrive", 200.0, 400.0, 76, 0.0, 50),
            new MatchPlaybackDTO.ObstaclePlacementDTO("object_buff_2", "barrier", 600.0, 400.0, 76, 0.0, 50));
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
        when(botSubmissionRepository.findByUserIdAndTestingSessionIdAndRequestFingerprintIsNotNull(
                any(UUID.class), any(String.class))).thenReturn(Optional.empty());
        when(simulationService.buildMatchObstacles(any(MatchSession.class))).thenReturn(matchObstacles);
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
                    "FIGHTER_WIN",
                    winner.userId(),
                    winner.username() + " wins the fight.");
        });
    }

    @Test
    void ratedReplayStreamsTheAuthoritativeResultWithTheBufferedTerminalFrame() {
        List<String> preparationSteps = new ArrayList<>();
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            preparationSteps.add("simulation");
            MatchSession session = invocation.getArgument(0);
            MatchService.MatchPlayer winner = session.players().getLast();
            MatchPlaybackDTO.ArenaStateDTO state =
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of());
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = List.of(
                    new MatchPlaybackDTO.ReplayFrameDTO(0, 0, List.of(), List.of()),
                    new MatchPlaybackDTO.ReplayFrameDTO(10, 500, List.of(), List.of()),
                    new MatchPlaybackDTO.ReplayFrameDTO(30, 1_500, List.of(), List.of()),
                    new MatchPlaybackDTO.ReplayFrameDTO(50, 2_500, List.of(), List.of()));
            return new MatchPlaybackDTO(
                    session.matchId(), MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED", state, frames, "FIGHTER_WIN", winner.userId(), "winner");
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

        assertThat(preparationSteps).containsExactly("simulation", "preparation");
        assertThat(events.stream()
                .filter(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .map(outbound -> outbound.event().type())
                .toList())
                .containsExactly("SIMULATION_PREPARING", "MATCH_REPLAY_BATCH", "MATCH_ROUND_READY");

        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().serverNow()).isNull();
                    assertThat(outbound.event().playbackStartsAt()).isNull();
                    assertThat(outbound.event().simulationPreparingDurationMs()).isEqualTo(3_000L);
                    assertThat(outbound.event().playback().frames())
                            .extracting(MatchPlaybackDTO.ReplayFrameDTO::elapsedMs)
                            .containsExactly(0, 1_000, 3_000);
                    assertThat(outbound.event().roundBrains()).isEmpty();
                    assertThat(outbound.event().abilityOffers()).isEmpty();
                });

        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().playback().frames())
                            .extracting(MatchPlaybackDTO.ReplayFrameDTO::elapsedMs)
                            .containsExactly(0, 1_000, 3_000);
                    assertThat(outbound.event().playback().winnerUserId()).isNull();
                    assertThat(outbound.event().playback().terminalBatch()).isFalse();
                    assertThat(outbound.event().playbackStartsAt()).isNull();
                    assertThat(outbound.event().resultRevealsAt()).isNull();
                    assertThat(outbound.event().roundReadyAt()).isNull();
                });
        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_REPLAY_BATCH"))
                .anySatisfy(outbound -> {
                    assertThat(outbound.event().player()).isNotNull();
                    assertThat(outbound.event().opponent()).isNotNull();
                    assertThat(outbound.event().players()).hasSize(2);
                    assertThat(outbound.event().roundBrains()).isEmpty();
                    assertThat(outbound.event().abilityOffers()).isEmpty();
                    assertThat(outbound.event().playback().terminalBatch()).isTrue();
                    assertThat(outbound.event().playback().frames())
                            .extracting(MatchPlaybackDTO.ReplayFrameDTO::elapsedMs)
                            .containsExactly(5_000);
                    assertThat(outbound.event().playback().result()).isEqualTo("FIGHTER_WIN");
                    assertThat(outbound.event().playback().winnerUserId()).isIn(firstUserId, secondUserId);
                    assertThat(outbound.event().playback().message()).isEqualTo("winner");
                    assertThat(outbound.delayMillis()).isEqualTo(5_000L);
                });
        assertThat(events)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.delayMillis()).isEqualTo(11_000L);
                    assertThat(outbound.event().roundReadyAt())
                            .isEqualTo(clock.instant().plusMillis(11_000));
                    assertThat(outbound.event().loadoutSelectionEndsAt())
                            .isEqualTo(outbound.event().roundReadyAt().plusSeconds(62));
                });
        assertThat(service.matchChatCloseAt(savedMatch.getId())).isNull();
    }

    @Test
    void firstQueuedPlayerWaitsForOpponent() {
        UUID firstUserId = UUID.randomUUID();

        List<MatchService.OutboundMatchmakingEvent> events =
                matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");

        assertThat(events).hasSize(1);
        MatchmakingEventDTO event = events.get(0).event();
        assertThat(events.get(0).principalName()).isEqualTo("pilot-one@example.com");
        assertThat(event.type()).isEqualTo("QUEUE_WAITING");
        assertThat(event.status()).isEqualTo("WAITING");
        assertThat(event.player().userId()).isEqualTo(firstUserId);
    }

    @Test
    void activeMatchStatusComesFromServerMatchAndDisconnectState() {
        UUID firstUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-one");
        matchmakingService.joinQueue(
                UUID.randomUUID(),
                "pilot-two",
                "pilot-two@example.com",
                "socket-two");

        var connectedStatus = service.activeMatchStatus(firstUserId);
        assertThat(connectedStatus.activeMatch()).isTrue();
        assertThat(connectedStatus.disconnected()).isFalse();

        assertThat(service.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-resumed"))
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().type()).isEqualTo("MATCH_FOUND");
                    assertThat(outbound.event().status()).isEqualTo("LOADOUT_SELECT");
                });

        service.markDisconnected(firstPrincipal, "socket-resumed");

        var disconnectedStatus = service.activeMatchStatus(firstUserId);
        assertThat(disconnectedStatus.activeMatch()).isTrue();
        assertThat(disconnectedStatus.disconnected()).isTrue();
        assertThat(disconnectedStatus.disconnectEndsAt())
                .isEqualTo(clock.instant().plusSeconds(30));
    }

    @Test
    void resumeWithoutAnActiveMatchReturnsAnExplicitStatusAndDoesNotEnterTheQueue() {
        UUID userId = UUID.randomUUID();

        assertThat(service.resumeMatch(
                userId,
                "pilot-one",
                "pilot-one@example.com",
                "socket-one"))
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().type()).isEqualTo("NO_ACTIVE_MATCH");
                    assertThat(outbound.event().status()).isEqualTo("NO_ACTIVE_MATCH");
                });

        List<MatchService.OutboundMatchmakingEvent> events =
                matchmakingService.joinQueue(UUID.randomUUID(), "pilot-two", "pilot-two@example.com");
        assertThat(events).singleElement().satisfies(outbound ->
                assertThat(outbound.event().type()).isEqualTo("QUEUE_WAITING"));
    }

    @Test
    void secondQueuedPlayerCreatesMatchFoundEventsForBothPlayers() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        MatchmakingService pendingMatchmakingService = new MatchmakingService(
                service,
                clock,
                new MatchmakingRateLimiter(clock));
        pendingMatchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");

        List<MatchService.OutboundMatchmakingEvent> events =
                pendingMatchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        assertThat(events).hasSize(2);
        assertThat(events).extracting(MatchService.OutboundMatchmakingEvent::principalName)
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(events).allSatisfy(outbound -> {
            MatchmakingEventDTO event = outbound.event();
            assertThat(event.type()).isEqualTo("MATCH_FOUND");
            assertThat(event.status()).isEqualTo("MATCH_ACCEPT");
            assertThat(event.matchId()).isNotNull();
            assertThat(event.players()).hasSize(2);
            assertThat(event.players()).extracting("slot").containsExactlyInAnyOrder(1, 2);
            assertThat(event.players()).extracting("selectedLoadout").containsOnly("custom::0,0,0,0");
            assertThat(event.players()).extracting("loadoutSelected").containsOnly(false);
            assertThat(event.opponent()).isNotNull();
            assertThat(event.matchAcceptanceEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:22Z"));
            assertThat(event.loadoutSelectionEndsAt()).isNull();
            assertThat(event.countdownEndsAt()).isNull();
            assertThat(event.testingEndsAt()).isNull();
            assertThat(event.rulesetVersion()).isEqualTo("duel-v1");
            assertThat(event.obstacles()).isEmpty();
        });
        assertThat(participants).isEmpty();
    }

    @Disabled("Replaced by combined loadout selection; object placement was removed")
    @Test
    void bothPlayersSelectingClassStartsObjectPlacementThenCountdown() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<MatchService.OutboundMatchmakingEvent> firstSelection =
                service.selectLoadout(firstUserId, "ranged");
        assertThat(firstSelection).hasSize(2);
        assertThat(firstSelection).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_LOADOUT_SELECTED");
            assertThat(outbound.event().status()).isEqualTo("LOADOUT_SELECT");
            assertThat(outbound.event().player().selectedLoadout()).isIn("ranged", "melee");
            assertThat(outbound.event().countdownEndsAt()).isNull();
        });

        List<MatchService.OutboundMatchmakingEvent> secondSelection =
                service.selectLoadout(secondUserId, "melee");
        assertThat(secondSelection).hasSize(2);
        assertThat(secondSelection).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_OBJECT_PLACEMENT_READY");
            assertThat(outbound.event().status()).isEqualTo("OBJECT_PLACEMENT");
            assertThat(outbound.event().objectPlacementEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:20Z"));
            assertThat(outbound.event().countdownEndsAt()).isNull();
            assertThat(outbound.event().players()).extracting("loadoutSelected").containsOnly(true);
            assertThat(outbound.event().players()).extracting("selectedLoadout").containsExactlyInAnyOrder("ranged", "melee");
        });

        List<MatchService.OutboundMatchmakingEvent> firstPlacement =
                service.submitObjectPlacements(firstUserId, List.of(playerObject("top-object", "healthPack", 300, 120, 42)));
        assertThat(firstPlacement).extracting(MatchService.OutboundMatchmakingEvent::principalName)
                .containsExactlyInAnyOrder("pilot-one@example.com", "pilot-two@example.com");
        assertThat(firstPlacement).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_OBJECTS_PLACED");
            assertThat(outbound.event().status()).isEqualTo("OBJECT_PLACEMENT");
            assertThat(outbound.event().objectPlacementUserId()).isEqualTo(firstUserId);
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2");
            assertThat(outbound.event().players()).filteredOn("username", "pilot-one")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(true);
            assertThat(outbound.event().players()).filteredOn("username", "pilot-two")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(false);
        });
        assertThat(firstPlacement)
                .filteredOn(outbound -> outbound.event().player().username().equals("pilot-two"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().player().objectPlacementSubmitted()).isFalse();
                    assertThat(outbound.event().opponent().objectPlacementSubmitted()).isTrue();
                    assertThat(outbound.event().objectPlacements()).isEmpty();
                });
        assertThat(firstPlacement)
                .filteredOn(outbound -> outbound.event().player().username().equals("pilot-one"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().player().objectPlacementSubmitted()).isTrue();
                    assertThat(outbound.event().objectPlacements()).hasSize(1);
                    assertThat(outbound.event().objectPlacements().getFirst().type()).isEqualTo("healthPack");
                });

        List<MatchService.OutboundMatchmakingEvent> secondPlacement =
                service.submitObjectPlacements(secondUserId, List.of(playerObject("bottom-object", "bouncyWall", 300, 700, 120)));
        assertThat(secondPlacement).hasSize(2);
        assertThat(secondPlacement).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().objectPlacementEndsAt()).isNull();
            assertThat(outbound.event().countdownEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:00Z"));
            assertThat(outbound.event().testingEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:30Z"));
            assertThat(outbound.event().obstacles()).hasSize(5);
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2", "object_1", "object_2");
        });
    }

    @Test
    void bothPlayersLockingLoadoutsStartsCountdownWithoutArenaObjects() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        Map<String, String> codes = Map.ofEntries(
                Map.entry("swing", "s"), Map.entry("block", "b"), Map.entry("dash", "d"), Map.entry("fire_gun", "g"),
                Map.entry("throw_grenade", "r"), Map.entry("shoot_fireball", "f"), Map.entry("stun", "t"), Map.entry("heavy_slash", "h"),
                Map.entry("repulsor_burst", "u"), Map.entry("concussive_shot", "c"), Map.entry("repair_pulse", "e"), Map.entry("proximity_mine", "m"),
                Map.entry("quick_jab", "j"), Map.entry("pistol_shot", "p"));
        var firstEvent = found.stream().map(MatchService.OutboundMatchmakingEvent::event)
                .filter(event -> event.player().userId().equals(firstUserId)).findFirst().orElseThrow();
        var secondEvent = found.stream().map(MatchService.OutboundMatchmakingEvent::event)
                .filter(event -> event.player().userId().equals(secondUserId)).findFirst().orElseThrow();
        assertThat(firstEvent.abilityOffers()).hasSize(6).doesNotHaveDuplicates();
        assertThat(secondEvent.abilityOffers()).hasSize(6).doesNotHaveDuplicates();
        assertThat(secondEvent.abilityOffers()).containsExactlyElementsOf(firstEvent.abilityOffers());
        String firstPicks = firstEvent.abilityOffers().stream().limit(3).map(codes::get).sorted().collect(java.util.stream.Collectors.joining());
        String secondPicks = secondEvent.abilityOffers().stream().limit(3).map(codes::get).sorted().collect(java.util.stream.Collectors.joining());

        service.selectLoadout(firstUserId, "custom:" + firstPicks + ":2,2,0,0");
        List<MatchService.OutboundMatchmakingEvent> events =
                service.selectLoadout(secondUserId, "custom:" + secondPicks + ":0,0,1,3");

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().message())
                    .isEqualTo("Both players have selected. Starting testing session.");
            assertThat(outbound.event().countdownEndsAt()).isEqualTo(clock.instant());
            assertThat(outbound.event().testingEndsAt()).isEqualTo(clock.instant().plusSeconds(32));
            assertThat(outbound.event().objectPlacementEndsAt()).isNull();
            assertThat(outbound.event().obstacles()).isEmpty();
            assertThat(outbound.event().players()).extracting("selectedLoadout")
                    .containsExactlyInAnyOrder("custom:" + firstPicks + ":2,2,0,0", "custom:" + secondPicks + ":0,0,1,3");
        });
    }

    @Test
    void loadoutSelectionAcceptsTheSecondPlayerDuringTheHiddenGraceWindow() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");

        clock.advance(Duration.ofSeconds(61));
        List<MatchService.OutboundMatchmakingEvent> events = service.selectLoadout(secondUserId, "melee");

        assertThat(events).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().countdownEndsAt()).isEqualTo(clock.instant());
            assertThat(outbound.event().testingEndsAt()).isEqualTo(clock.instant().plusSeconds(32));
        });
    }

    @Test
    void testingTimeoutWaitsForTheHiddenTwoSecondSubmissionGrace() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = found.getFirst().event().matchId();
        service.selectLoadout(firstUserId, "melee");
        List<MatchService.OutboundMatchmakingEvent> countdown = service.selectLoadout(secondUserId, "melee");
        Instant authoritativeDeadline = countdown.getFirst().event().testingEndsAt();

        clock.advance(Duration.ofSeconds(30));
        assertThat(service.resolveTestingTimeout(matchId, authoritativeDeadline)).isEmpty();

        clock.advance(Duration.ofSeconds(2));
        assertThat(service.resolveTestingTimeout(matchId, authoritativeDeadline)).hasSize(2);
    }

    @Test
    void testingTimeoutCreatesCanonicalEmptyBrainsForAnUntouchedFirstRound() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = found.getFirst().event().matchId();

        service.selectLoadout(firstUserId, "melee");
        List<MatchService.OutboundMatchmakingEvent> countdown = service.selectLoadout(secondUserId, "melee");
        Instant deadline = countdown.getFirst().event().testingEndsAt();

        clock.advance(Duration.ofSeconds(32));
        List<MatchService.OutboundMatchmakingEvent> resolved =
                service.resolveTestingTimeout(matchId, deadline);

        assertThat(resolved).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo("SIMULATION_LOADING"));
        assertThat(participants).allSatisfy(participant -> {
            BotSubmission submission = participant.getBotSubmission();
            assertThat(submission).isNotNull();
            assertThat(submission.getClientBuildVersion()).isEqualTo("server-testing-timeout-v1");
            assertThat(submission.getBrainPayload()).contains("\"columns\":[]");
        });
    }

    @Test
    void laterRoundTestingTimeoutReusesThePreviousAcceptedBrain() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        String previousBrain = "{\"version\":\"bot-logic-tree-v1\",\"columns\":[{\"id\":\"saved-column\",\"branches\":[]}]}";
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        List<MatchService.OutboundMatchmakingEvent> firstCountdown = service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId, previousBrain);
        stubSubmission(secondUserId, secondSubmissionId, previousBrain);
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        service.selectLoadout(firstUserId, "melee");
        List<MatchService.OutboundMatchmakingEvent> secondCountdown = service.selectLoadout(secondUserId, "melee");
        Instant deadline = secondCountdown.getFirst().event().testingEndsAt();

        clock.advance(Duration.ofSeconds(32));
        List<MatchService.OutboundMatchmakingEvent> resolved =
                service.resolveTestingTimeout(savedMatch.getId(), deadline);

        assertThat(resolved).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo("SIMULATION_LOADING"));
        assertThat(participants).allSatisfy(participant -> {
            BotSubmission submission = participant.getBotSubmission();
            assertThat(submission).isNotNull();
            assertThat(submission.getId()).isNotEqualTo(firstSubmissionId);
            assertThat(submission.getId()).isNotEqualTo(secondSubmissionId);
            assertThat(submission.getBrainPayload()).contains("saved-column");
            assertThat(submission.getClientBuildVersion()).isEqualTo("server-testing-timeout-v1");
        });
        assertThat(firstCountdown.getFirst().event().testingEndsAt())
                .isEqualTo(clock.instant());
    }

    @Test
    void partialAndEmptyRoundOneLoadoutsAreCompletedWhenPlayersLock() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        Map<String, String> codes = Map.ofEntries(
                Map.entry("swing", "s"), Map.entry("block", "b"), Map.entry("dash", "d"), Map.entry("fire_gun", "g"),
                Map.entry("throw_grenade", "r"), Map.entry("shoot_fireball", "f"), Map.entry("stun", "t"), Map.entry("heavy_slash", "h"),
                Map.entry("repulsor_burst", "u"), Map.entry("concussive_shot", "c"), Map.entry("repair_pulse", "e"), Map.entry("proximity_mine", "m"),
                Map.entry("quick_jab", "j"), Map.entry("pistol_shot", "p"));
        String selectedCode = codes.get(found.getFirst().event().abilityOffers().getFirst());

        List<MatchService.OutboundMatchmakingEvent> firstLock =
                service.selectLoadout(firstUserId, "custom:" + selectedCode + ":1,1,1,1");

        assertThat(firstLock).hasSize(2).allSatisfy(outbound -> {
            String firstLoadout = outbound.event().players().stream()
                    .filter(player -> player.userId().equals(firstUserId))
                    .findFirst()
                    .orElseThrow()
                    .selectedLoadout();
            assertThat(firstLoadout.split(":", -1)[1])
                    .hasSize(3)
                    .contains(selectedCode);
        });

        List<MatchService.OutboundMatchmakingEvent> repeatedFirstLock =
                service.selectLoadout(firstUserId, "custom::0,0,0,0");
        assertThat(repeatedFirstLock).singleElement().satisfies(outbound ->
                assertThat(outbound.event().player().selectedLoadout().split(":", -1)[1])
                        .hasSize(3)
                        .contains(selectedCode));

        List<MatchService.OutboundMatchmakingEvent> secondLock =
                service.selectLoadout(secondUserId, "custom::0,0,0,0");

        assertThat(secondLock).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().players()).allSatisfy(player ->
                    assertThat(player.selectedLoadout().split(":", -1)[1]).hasSize(3));
        });
    }

    @Test
    void roundOneTimeoutAutomaticallySelectsThreeAbilitiesForBothPlayers() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = found.getFirst().event().matchId();

        clock.advance(Duration.ofSeconds(64));
        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveLoadoutSelectionTimeout(matchId);

        assertThat(timeoutEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().countdownEndsAt())
                    .isEqualTo(outbound.event().loadoutSelectionEndsAt());
            assertThat(outbound.event().players()).allSatisfy(player -> {
                assertThat(player.loadoutSelected()).isTrue();
                assertThat(player.selectedLoadout().split(":", -1)[1]).hasSize(3);
            });
        });
    }

    @Test
    void lockedPlayersDeadlineSyncResolvesTheExpiredDraftForBothPlayers() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "custom::0,0,0,0");

        clock.advance(Duration.ofSeconds(64));
        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.selectLoadout(firstUserId, "custom::0,0,0,0");

        assertThat(timeoutEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().countdownEndsAt())
                    .isEqualTo(outbound.event().loadoutSelectionEndsAt());
            assertThat(outbound.event().players()).allSatisfy(player -> {
                assertThat(player.loadoutSelected()).isTrue();
                assertThat(player.selectedLoadout().split(":", -1)[1]).hasSize(3);
            });
        });
    }

    @Test
    void backendSweepResolvesExpiredDraftWithoutAnyPlayerMessage() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "custom::0,0,0,0");

        clock.advance(Duration.ofSeconds(64));
        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveExpiredLoadoutSelections();

        assertThat(timeoutEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().countdownEndsAt())
                    .isEqualTo(outbound.event().loadoutSelectionEndsAt());
            assertThat(outbound.event().players()).allSatisfy(player ->
                    assertThat(player.loadoutSelected()).isTrue());
        });
        assertThat(service.resolveExpiredLoadoutSelections()).isEmpty();
    }

    @Test
    void reconnectDuringReplayRestoresReplayInsteadOfExposingNextRoundSelection() {
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
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        List<MatchService.OutboundMatchmakingEvent> reconnectEvents =
                service.resumeMatch(
                        firstUserId,
                        "pilot-one",
                        "pilot-one@example.com",
                        "socket-reconnected");

        assertThat(reconnectEvents).singleElement().satisfies(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("SIMULATION_PREPARING");
            assertThat(outbound.event().status()).isEqualTo("SIMULATION_PREPARING");
            assertThat(outbound.event().playback()).isNotNull();
            assertThat(outbound.event().roundNumber()).isEqualTo(1);
            assertThat(outbound.event().players()).extracting("roundWins").containsOnly(0);
            assertThat(outbound.event().serverNow()).isNull();
            assertThat(outbound.event().playbackStartsAt()).isNull();
            assertThat(outbound.event().simulationPreparingDurationMs()).isEqualTo(3_000L);
        });

        clock.advance(Duration.ofMillis(3_300));
        List<MatchService.OutboundMatchmakingEvent> duringResultHold =
                service.resumeMatch(
                        firstUserId,
                        "pilot-one",
                        "pilot-one@example.com",
                        "socket-reconnected-again");
        assertThat(duringResultHold).extracting(outbound -> outbound.event().type())
                .containsExactly("SIMULATION_PREPARING");
        assertThat(duringResultHold.get(0).event().players()).extracting("roundWins")
                .containsExactlyInAnyOrder(0, 1);
        assertThat(duringResultHold.get(0).event().playback().result()).isEqualTo("FIGHTER_WIN");
    }

    @Test
    void reconnectDuringReplayReceivesCurrentAndBufferedFramesAndNotifiesBothPlayers() {
        when(simulationService.buildDuelPlayback(any(MatchSession.class), any())).thenAnswer(invocation -> {
            MatchSession session = invocation.getArgument(0);
            List<MatchPlaybackDTO.ReplayFrameDTO> frames = new ArrayList<>();
            for (int elapsedMs = 0, tick = 0; elapsedMs <= 10_000; elapsedMs += 1_000, tick += 1) {
                frames.add(new MatchPlaybackDTO.ReplayFrameDTO(tick, elapsedMs, List.of(), List.of()));
            }
            MatchService.MatchPlayer winner = session.players().getLast();
            return new MatchPlaybackDTO(
                    session.matchId(), MatchSimulationService.DUEL_RULESET_VERSION,
                    "COMPLETED",
                    new MatchPlaybackDTO.ArenaStateDTO(800, 800, List.of(), List.of()),
                    frames,
                    "FIGHTER_WIN",
                    winner.userId(),
                    "winner");
        });
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
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        clock.advance(Duration.ofMillis(5_500));
        Instant deadline = service.markDisconnected(firstPrincipal).getFirst().event().disconnectEndsAt();
        List<MatchService.OutboundMatchmakingEvent> reconnectEvents = service.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-reconnected");

        assertThat(reconnectEvents).extracting(outbound -> outbound.event().type())
                .contains("SIMULATION_PREPARING", "MATCH_REPLAY_BATCH", "PLAYER_RECONNECTED");
        MatchPlaybackDTO ready = reconnectEvents.stream()
                .map(MatchService.OutboundMatchmakingEvent::event)
                .filter(event -> "SIMULATION_PREPARING".equals(event.type()))
                .findFirst()
                .orElseThrow()
                .playback();
        assertThat(ready.frames()).extracting(MatchPlaybackDTO.ReplayFrameDTO::elapsedMs)
                .containsExactly(0, 500, 1_000, 1_500, 2_000, 2_500);
        MatchPlaybackDTO buffer = reconnectEvents.stream()
                .map(MatchService.OutboundMatchmakingEvent::event)
                .filter(event -> "MATCH_REPLAY_BATCH".equals(event.type()))
                .findFirst()
                .orElseThrow()
                .playback();
        assertThat(buffer.frames()).extracting(MatchPlaybackDTO.ReplayFrameDTO::elapsedMs)
                .containsExactly(3_000, 3_500, 4_000, 4_500);
        assertThat(reconnectEvents)
                .filteredOn(outbound -> "PLAYER_RECONNECTED".equals(outbound.event().type()))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().disconnectedUserId()).isNull();
                    assertThat(outbound.event().disconnectEndsAt()).isNull();
                });
        assertThat(service.resolveDisconnectTimeout(firstPrincipal, deadline)).isEmpty();
    }

    @Test
    void laterRoundTimeoutAutomaticallyFillsMissingAbilityPicksAndStartsCountdown() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = found.getFirst().event().matchId();
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        clock.advance(Duration.ofSeconds(71));
        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveLoadoutSelectionTimeout(matchId);

        assertThat(timeoutEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().countdownEndsAt())
                    .isEqualTo(outbound.event().loadoutSelectionEndsAt());
            assertThat(outbound.event().roundNumber()).isEqualTo(2);
            assertThat(outbound.event().players()).allSatisfy(player -> {
                assertThat(player.loadoutSelected()).isTrue();
                assertThat(player.selectedLoadout().split(":", -1)[1]).hasSize(2);
            });
        });
    }

    @Disabled("Object placement was removed")
    @Test
    void emptyObjectSubmissionIsAcknowledgedAndDoesNotCreatePlaceholderObjects() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");

        List<MatchService.OutboundMatchmakingEvent> firstPlacement =
                service.submitObjectPlacements(firstUserId, List.of());

        assertThat(firstPlacement).hasSize(2);
        assertThat(firstPlacement).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_OBJECTS_PLACED");
            assertThat(outbound.event().objectPlacementUserId()).isEqualTo(firstUserId);
            assertThat(outbound.event().players()).filteredOn("username", "pilot-one")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(true);
            assertThat(outbound.event().players()).filteredOn("username", "pilot-two")
                    .extracting("objectPlacementSubmitted")
                    .containsExactly(false);
            assertThat(outbound.event().objectPlacements()).isEmpty();
        });

        List<MatchService.OutboundMatchmakingEvent> secondPlacement =
                service.submitObjectPlacements(secondUserId,
                        List.of(playerObject("bottom-object", "healthPack", 300, 700, 42)));

        assertThat(secondPlacement).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2", "object_1");
        });
    }

    @Disabled("Object placement was removed")
    @Test
    void objectSubmissionIsCappedAtThreeAndClampedToThePlayersThird() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");

        List<MatchService.OutboundMatchmakingEvent> firstPlacement =
                service.submitObjectPlacements(firstUserId, List.of(
                        playerObject("one", "healthPack", -100, -100, 42),
                        playerObject("two", "projectileWall", 900, 900, 120),
                        playerObject("three", "bouncyWall", 400, 400, 120),
                        playerObject("ignored", "healthPack", 200, 200, 42)));

        assertThat(firstPlacement).filteredOn(outbound -> outbound.principalName().equals("pilot-one@example.com"))
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().objectPlacements()).hasSize(3);
                    assertThat(outbound.event().objectPlacements()).allSatisfy(object -> {
                        assertThat(object.x()).isBetween(0.0, 1600.0);
                        assertThat(object.y()).isBetween(0.0, 1600.0 / 3.0);
                    });
                });

        List<MatchService.OutboundMatchmakingEvent> secondPlacement =
                service.submitObjectPlacements(secondUserId, List.of());
        assertThat(secondPlacement).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().obstacles()).hasSize(6);
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2", "object_1", "object_2", "object_3");
        });
    }

    @Test
    void sameUserCannotOccupyBothMatchSlots() {
        UUID userId = UUID.randomUUID();
        matchmakingService.joinQueue(userId, "pilot-one", "pilot-one@example.com");

        List<MatchService.OutboundMatchmakingEvent> events =
                matchmakingService.joinQueue(userId, "pilot-one", "pilot-one@example.com");

        assertThat(events).hasSize(1);
        assertThat(events.get(0).event().type()).isEqualTo("QUEUE_WAITING");
    }

    @Disabled("Object placement was removed")
    @Test
    void objectPlacementTimeoutStartsCountdownWithNoObjectsWhenNobodySubmits() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> matchEvents =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = matchEvents.getFirst().event().matchId();
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");

        clock.advance(Duration.ofSeconds(21));
        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveObjectPlacementTimeout(matchId);

        assertThat(timeoutEvents).hasSize(2);
        assertThat(timeoutEvents).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().obstacles()).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                    .containsExactly("object_center", "object_buff_1", "object_buff_2");
            assertThat(outbound.event().countdownEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:26Z"));
            assertThat(outbound.event().testingEndsAt()).isEqualTo(Instant.parse("2026-06-03T12:00:56Z"));
        });
    }

    @Disabled("Old round/object lifecycle")
    @Test
    void firstRoundWinProducesPlaybackAndNextRoundEvents() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        UUID secondSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        List<MatchService.OutboundMatchmakingEvent> matchFoundEvents =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        Long initialSeed = matchFoundEvents.getFirst().event().simulationSeed();
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        service.submitObjectPlacements(firstUserId, List.of(playerObject("top-object", "healthPack", 300, 120, 42)));
        List<MatchService.OutboundMatchmakingEvent> initialRoundEvents =
                service.submitObjectPlacements(secondUserId,
                        List.of(playerObject("bottom-object", "bouncyWall", 300, 700, 120)));
        List<MatchPlaybackDTO.ObstaclePlacementDTO> canonicalRoundObjects =
                initialRoundEvents.getFirst().event().obstacles();
        stubSubmission(firstUserId, firstSubmissionId);
        stubSubmission(secondUserId, secondSubmissionId);

        List<MatchService.OutboundMatchmakingEvent> firstFinishEvents =
                service.markFinished(firstUserId, firstSubmissionId);
        assertThat(firstFinishEvents).hasSize(2);
        assertThat(firstFinishEvents).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("PLAYER_FINISHED");
            assertThat(outbound.event().status()).isEqualTo("WAITING_FOR_FINISH");
            assertThat(outbound.event().playback()).isNull();
        });

        List<MatchService.OutboundMatchmakingEvent> secondFinishEvents =
                service.markFinished(secondUserId, secondSubmissionId);
        assertThat(secondFinishEvents).hasSize(4);
        assertThat(secondFinishEvents)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("SIMULATION_PREPARING");
                    assertThat(outbound.event().playback()).isNotNull();
                    assertThat(outbound.event().playback().result()).isNull();
                    assertThat(outbound.event().players()).extracting("roundWins").containsOnly(0);
                    assertThat(outbound.delayMillis()).isEqualTo(3_000L);
                });
        assertThat(secondFinishEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().status()).isEqualTo("PREP");
                    assertThat(outbound.event().roundNumber()).isEqualTo(2);
                    assertThat(outbound.event().winsRequired()).isEqualTo(2);
                    assertThat(outbound.event().simulationSeed()).isEqualTo(initialSeed);
                    assertThat(outbound.event().obstacles()).isEqualTo(canonicalRoundObjects);
                    assertThat(outbound.event().objectPlacementEndsAt()).isNull();
                    assertThat(outbound.event().countdownEndsAt()).isNotNull();
                    assertThat(outbound.event().player().finished()).isFalse();
                    assertThat(outbound.event().players()).extracting("roundWins").containsExactlyInAnyOrder(0, 1);
                    assertThat(outbound.delayMillis()).isPositive();
                });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.RUNNING);
    }

    @Disabled("Old round/object lifecycle")
    @Test
    void secondRoundWinCompletesBestOfThreeMatch() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        submitDefaultObjects(firstUserId, secondUserId);

        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        service.markFinished(firstUserId, firstRoundFirstSubmission);
        service.markFinished(secondUserId, firstRoundSecondSubmission);
        assertThat(service.submitObjectPlacements(firstUserId,
                List.of(playerObject("ignored-second-round", "projectileWall", 180, 140, 120)))).isEmpty();

        UUID secondRoundFirstSubmission = UUID.randomUUID();
        UUID secondRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, secondRoundFirstSubmission);
        stubSubmission(secondUserId, secondRoundSecondSubmission);
        service.markFinished(firstUserId, secondRoundFirstSubmission);
        List<MatchService.OutboundMatchmakingEvent> finalEvents =
                service.markFinished(secondUserId, secondRoundSecondSubmission);

        assertThat(finalEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_ROUND_READY"))
                .isEmpty();
        assertThat(finalEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_REPLAY_BATCH"))
                .hasSize(2)
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().playback().terminalBatch()).isTrue();
                    assertThat(outbound.event().playback().winnerUserId()).isEqualTo(secondUserId);
                });
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getWinnerUser().getId()).isEqualTo(secondUserId);
    }

    @Disabled("Object placement was removed")
    @Test
    void laterRoundsReuseInitialObjectPlacementsAndSkipPlacement() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        submitDefaultObjects(firstUserId, secondUserId);

        UUID firstRoundFirstSubmission = UUID.randomUUID();
        UUID firstRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, firstRoundFirstSubmission);
        stubSubmission(secondUserId, firstRoundSecondSubmission);
        service.markFinished(firstUserId, firstRoundFirstSubmission);
        service.markFinished(secondUserId, firstRoundSecondSubmission);

        assertThat(service.submitObjectPlacements(firstUserId,
                List.of(playerObject("top-second-round", "projectileWall", 180, 140, 120)))).isEmpty();
        assertThat(service.submitObjectPlacements(secondUserId,
                List.of(playerObject("bottom-second-round", "healthPack", 620, 690, 42)))).isEmpty();

        UUID secondRoundFirstSubmission = UUID.randomUUID();
        UUID secondRoundSecondSubmission = UUID.randomUUID();
        stubSubmission(firstUserId, secondRoundFirstSubmission);
        stubSubmission(secondUserId, secondRoundSecondSubmission);
        service.markFinished(firstUserId, secondRoundFirstSubmission);
        service.markFinished(secondUserId, secondRoundSecondSubmission);

        assertThat(simulatedSessions).hasSize(2);
        assertThat(simulatedSessions.get(1).obstacles())
                .filteredOn(obstacle -> obstacle.id().equals("object_1") || obstacle.id().equals("object_2"))
                .extracting(MatchPlaybackDTO.ObstaclePlacementDTO::type)
                .containsExactly("healthPack", "bouncyWall");
        assertThat(simulatedSessions.get(1).obstacles()).isEqualTo(simulatedSessions.get(0).obstacles());
        assertThat(simulatedSessions.get(1).obstacles())
                .filteredOn(obstacle -> obstacle.id().equals("object_1"))
                .singleElement()
                .satisfies(obstacle -> assertThat(obstacle.x()).isEqualTo(300.0));
        assertThat(simulatedSessions.get(1).obstacles())
                .filteredOn(obstacle -> obstacle.id().equals("object_2"))
                .singleElement()
                .satisfies(obstacle -> assertThat(obstacle.x()).isEqualTo(300.0));
    }

    @Test
    void disconnectExpiringDuringFirstSelectionCompletesMatchAsDraw() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");

        List<MatchService.OutboundMatchmakingEvent> notices = service.markDisconnected(firstPrincipal);
        Instant deadline = notices.get(0).event().disconnectEndsAt();
        assertThat(notices).hasSize(2);
        assertThat(deadline).isEqualTo(clock.instant().plusSeconds(30));
        assertThat(service.resolveDisconnectTimeout(firstPrincipal, deadline)).isEmpty();

        clock.advance(Duration.ofSeconds(30));
        List<MatchService.OutboundMatchmakingEvent> results =
                service.resolveDisconnectTimeout(firstPrincipal, deadline);

        assertThat(results).hasSize(2);
        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("INITIAL_DISCONNECTION");
        assertThat(savedMatch.getWinnerUser()).isNull();
        assertThat(participants).allSatisfy(participant ->
                assertThat(participant.getResult()).isEqualTo(MatchResult.DRAW));
        assertThat(results).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().status()).isEqualTo("COMPLETED");
            assertThat(outbound.event().playback().result()).isEqualTo("DRAW");
            assertThat(outbound.event().playback().winnerUserId()).isNull();
        });
    }

    @Test
    void disconnectAfterOpeningSelectionCompletesIsAForfeitRatherThanCancellation() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");

        Instant deadline = service.markDisconnected(firstPrincipal)
                .getFirst()
                .event()
                .disconnectEndsAt();
        clock.advance(Duration.ofSeconds(30));
        List<MatchService.OutboundMatchmakingEvent> results =
                service.resolveDisconnectTimeout(firstPrincipal, deadline);

        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("DISCONNECTION");
        assertThat(results).allSatisfy(outbound ->
                assertThat(outbound.event().playback().result()).isEqualTo("DISCONNECTION_WIN"));
    }

    @Test
    void selectionTimeoutAutoPicksDisconnectedPlayersAbilitiesWhileGracePeriodRemains() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        String firstPrincipal = "pilot-one@example.com";
        matchmakingService.joinQueue(firstUserId, "pilot-one", firstPrincipal);
        List<MatchService.OutboundMatchmakingEvent> found =
                matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        UUID matchId = found.getFirst().event().matchId();

        clock.advance(Duration.ofSeconds(40));
        Instant disconnectDeadline =
                service.markDisconnected(firstPrincipal).getFirst().event().disconnectEndsAt();
        clock.advance(Duration.ofSeconds(23));

        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveLoadoutSelectionTimeout(matchId);

        assertThat(clock.instant()).isBefore(disconnectDeadline);
        assertThat(timeoutEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("BOT_TESTING_SESSION_READY");
            assertThat(outbound.event().status()).isEqualTo("PREP");
            assertThat(outbound.event().players()).allSatisfy(player -> {
                assertThat(player.loadoutSelected()).isTrue();
                assertThat(player.selectedLoadout().split(":", -1)[1]).hasSize(3);
            });
        });
        assertThat(timeoutEvents)
                .filteredOn(outbound -> outbound.event().player().userId().equals(secondUserId))
                .singleElement()
                .satisfies(outbound -> {
                    assertThat(outbound.event().opponent().userId()).isEqualTo(firstUserId);
                    assertThat(outbound.event().opponent().selectedLoadout().split(":", -1)[1]).hasSize(3);
                });
    }

    @Test
    void testingDeadlineBuildsAReplayWithBothMatchMembersWhenOneNeverSubmits() {
        UUID firstUserId = UUID.randomUUID();
        UUID secondUserId = UUID.randomUUID();
        UUID firstSubmissionId = UUID.randomUUID();
        matchmakingService.joinQueue(firstUserId, "pilot-one", "pilot-one@example.com");
        matchmakingService.joinQueue(secondUserId, "pilot-two", "pilot-two@example.com");
        service.selectLoadout(firstUserId, "melee");
        service.selectLoadout(secondUserId, "melee");
        stubSubmission(firstUserId, firstSubmissionId);
        service.markFinished(firstUserId, firstSubmissionId);

        clock.advance(Duration.ofSeconds(32));
        List<MatchService.OutboundMatchmakingEvent> timeoutEvents =
                service.resolveExpiredTestingSessions();

        assertThat(timeoutEvents).hasSize(2).allSatisfy(outbound ->
                assertThat(outbound.event().type()).isEqualTo("SIMULATION_LOADING"));

        service.completeSimulation(savedMatch.getId());

        assertThat(simulatedSessions).hasSize(1);
        assertThat(simulatedSessions.getFirst().players()).hasSize(2);
        assertThat(simulatedSessions.getFirst().players())
                .extracting(MatchService.MatchPlayer::userId)
                .containsExactlyInAnyOrder(firstUserId, secondUserId);
    }

    @Test
    void reconnectDuringSimulationPreparationResumesThatServerPhase() {
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
        service.markFinished(firstUserId, firstSubmissionId);
        when(simulationService.buildPreparationPlayback(any())).thenAnswer(invocation ->
                preparationPlayback(invocation.getArgument(0)));
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        verify(simulationService, times(1)).buildPreparationPlayback(any(MatchSession.class));

        Instant disconnectDeadline = service.markDisconnected(firstPrincipal)
                .getFirst()
                .event()
                .disconnectEndsAt();
        List<MatchService.OutboundMatchmakingEvent> resumeEvents = service.resumeMatch(
                firstUserId,
                "pilot-one",
                firstPrincipal,
                "socket-reconnected");

        assertThat(disconnectDeadline).isEqualTo(clock.instant().plusSeconds(30));
        assertThat(resumeEvents)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("SIMULATION_PREPARING");
                    assertThat(outbound.event().status()).isEqualTo("SIMULATION_PREPARING");
            assertThat(outbound.event().players()).hasSize(2);
            assertThat(outbound.event().serverNow()).isNull();
            assertThat(outbound.event().playbackStartsAt()).isNull();
            assertThat(outbound.event().simulationPreparingDurationMs()).isEqualTo(3_000L);
        });
        assertThat(resumeEvents)
                .extracting(outbound -> outbound.event().type())
                .contains("PLAYER_RECONNECTED");
        assertThat(resumeEvents)
                .filteredOn(outbound -> outbound.event().type().equals("MATCH_REPLAY_BATCH"))
                .isEmpty();
        assertThat(resumeEvents)
                .filteredOn(outbound -> outbound.event().type().equals("PLAYER_RECONNECTED"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().playback()).isNotNull();
                    assertThat(outbound.event().playback().initialState().fighters()).hasSize(2);
                });
    }

    @Test
    void activeDisconnectMetadataSurvivesThePreparationToReplayTransition() {
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
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        Instant disconnectDeadline = service.markDisconnected(firstPrincipal)
                .getFirst()
                .event()
                .disconnectEndsAt();

        List<MatchService.OutboundMatchmakingEvent> replayEvents =
                service.completeSimulation(savedMatch.getId());

        assertThat(replayEvents)
                .filteredOn(outbound -> outbound.event().type().equals("SIMULATION_PREPARING"))
                .allSatisfy(outbound -> {
                    assertThat(outbound.event().disconnectedUserId()).isEqualTo(firstUserId);
                    assertThat(outbound.event().disconnectEndsAt()).isEqualTo(disconnectDeadline);
                });
    }

    @Test
    void disconnectDuringReplayReplacesPendingReplayWithAForfeitResult() {
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
        service.markFinished(firstUserId, firstSubmissionId);
        service.markFinished(secondUserId, secondSubmissionId);
        service.completeSimulation(savedMatch.getId());

        Instant deadline = service.markDisconnected(firstPrincipal)
                .getFirst()
                .event()
                .disconnectEndsAt();
        clock.advance(Duration.ofSeconds(30));
        List<MatchService.OutboundMatchmakingEvent> resultEvents =
                service.resolveDisconnectTimeout(firstPrincipal, deadline);

        assertThat(savedMatch.getStatus()).isEqualTo(MatchStatus.COMPLETED);
        assertThat(savedMatch.getCompletionReason()).isEqualTo("DISCONNECTION");
        assertThat(resultEvents).hasSize(2).allSatisfy(outbound -> {
            assertThat(outbound.event().type()).isEqualTo("MATCH_RESULT_READY");
            assertThat(outbound.event().playback().result()).isEqualTo("DISCONNECTION_WIN");
            assertThat(outbound.event().playback().frames()).isEmpty();
        });
        assertThat(service.isDelayedReplayEventStillValid(
                savedMatch.getId(), "MATCH_REPLAY_BATCH")).isFalse();
    }

    @Test
    void disconnectExpiringDuringSecondSelectionIsAForfeitRegardlessOfRoundScore() {
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

    private void submitDefaultObjects(UUID firstUserId, UUID secondUserId) {
        service.submitObjectPlacements(firstUserId, List.of(playerObject("top-object", "healthPack", 300, 120, 42)));
        service.submitObjectPlacements(secondUserId, List.of(playerObject("bottom-object", "bouncyWall", 300, 700, 120)));
    }

    private MatchPlaybackDTO.ObstaclePlacementDTO playerObject(String id, String type, double x, double y, int size) {
        return new MatchPlaybackDTO.ObstaclePlacementDTO(id, type, x, y, size);
    }

    private MatchPlaybackDTO preparationPlayback(MatchSession session) {
        List<MatchPlaybackDTO.FighterPlacementDTO> fighters = session.players().stream()
                .map(player -> new MatchPlaybackDTO.FighterPlacementDTO(
                        player.userId(),
                        player.username(),
                        player.slot(),
                        player.slot() == 1 ? 500.0 : 500.0,
                        player.slot() == 1 ? 150.0 : 850.0,
                        player.slot() == 1 ? 180.0 : 0.0,
                        100,
                        "melee",
                        false,
                        false,
                        null,
                        null))
                .toList();
        return new MatchPlaybackDTO(
                session.matchId(),
                MatchSimulationService.DUEL_RULESET_VERSION,
                "PREPARING",
                new MatchPlaybackDTO.ArenaStateDTO(1000, 1000, fighters, List.of()),
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
                return events;
            }
            UUID pendingMatchId = events.getFirst().event().matchId();
            UUID firstUserId = events.getFirst().event().player().userId();
            UUID secondUserId = events.get(1).event().player().userId();
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
