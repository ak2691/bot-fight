package com.example.botfight.DTO.match;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchReplayDTOTest {
    private final JsonMapper jsonMapper = new JsonMapper();

    @Test
    void compactReplayOmitsIdentityAndUnusedBotState() {
        MatchPlaybackDTO.BotStateDTO bot = new MatchPlaybackDTO.BotStateDTO(
                UUID.randomUUID(),
                "pilot",
                1,
                500,
                120,
                0,
                        85,
                        140,
                        "custom:g",
                        List.of(2, 3, 5, 16, 17, 19, 20),
                        List.of(),
                        Map.of(2, 900, 3, 2_500),
                Map.of(3, 700, 19, 0),
                Map.of(2, 4, 3, 0, 5, 4),
                Map.of(2, 1_000),
                3,
                null,
                0,
                0,
                500,
                120,
                0,
                0);
        MatchPlaybackDTO playback = new MatchPlaybackDTO(
                UUID.randomUUID(),
                "duel-v1",
                "COMPLETED",
                new MatchPlaybackDTO.ArenaStateDTO(1_000, 800, List.of(bot), List.of()),
                List.of(new MatchPlaybackDTO.ReplayFrameDTO(
                        1,
                        100,
                        List.of(bot),
                        List.of())),
                "DRAW",
                null,
                "The fight ended in a draw.");

        MatchReplayDTO compact = MatchReplayDTO.from(playback);
        String json = jsonMapper.writeValueAsString(compact);

        assertThat(compact.initialState().bots().getFirst().maxHp()).isEqualTo(140);
        assertThat(compact.initialState().bots().getFirst().rotation()).isNull();
        assertThat(compact.initialState().bots().getFirst().abilities())
                .containsExactly(2, 3, 5, 16, 17, 19, 20);
        assertThat(compact.initialState().bots().getFirst().abilityCooldowns())
                .containsEntry(2, 900)
                .containsEntry(3, 2_500)
                .containsEntry(19, 0)
                .containsEntry(20, 0);
        assertThat(compact.initialState().bots().getFirst().abilityCharges())
                .containsExactlyInAnyOrderEntriesOf(Map.of(2, 4, 3, 0, 5, 4));
        assertThat(compact.initialState().bots().getFirst().abilityRechargeMs())
                .containsEntry(2, 1_000)
                .containsEntry(3, 0)
                .containsEntry(5, 0);
        assertThat(compact.frames().getFirst().bots().getFirst().abilityCooldowns())
                .containsExactlyInAnyOrderEntriesOf(Map.of(2, 900, 3, 2_500));
        assertThat(compact.frames().getFirst().bots().getFirst().abilityCharges())
                .containsExactlyInAnyOrderEntriesOf(Map.of(2, 4, 3, 0, 5, 4));
        assertThat(compact.frames().getFirst().bots().getFirst().abilityRechargeMs())
                .containsExactlyInAnyOrderEntriesOf(Map.of(2, 1_000));
        assertThat(compact.frames().getFirst().bots().getFirst().abilityActiveMs())
                .containsOnlyKeys(3);
        assertThat(json).contains("\"slot\":1", "\"abilityCooldowns\"", "\"abilityCharges\"", "\"abilityRechargeMs\"", "\"abilityActiveMs\"");
        assertThat(json).doesNotContain(
                "userId",
                "username",
                "combatLoadout",
                "preparingMs",
                "\"entities\"");
        assertThat(compact.frames().getFirst().bots().getFirst().triggeredAbility()).isEqualTo(3);
        assertThat(json).contains("\"triggeredAbility\":3");

        assertThat(json).doesNotContain("terminalBatch");
    }

    @Test
    void compactReplayPreservesPresentationStateNeededBySharedPixiVisuals() {
        MatchPlaybackDTO.BotStateDTO bot = new MatchPlaybackDTO.BotStateDTO(
                UUID.randomUUID(),
                "pilot",
                1,
                500,
                120,
                35,
                85,
                140,
                "custom:g",
                List.of(16, 20),
                List.of(),
                Map.of(),
                Map.of(20, 200),
                Map.of(),
                Map.of(),
                20,
                null,
                450,
                0,
                500,
                120,
                0,
                0,
                1,
                720d,
                340d,
                125d,
                235d,
                35d);
        MatchPlaybackDTO playback = new MatchPlaybackDTO(
                UUID.randomUUID(),
                "duel-v1",
                "COMPLETED",
                new MatchPlaybackDTO.ArenaStateDTO(1_000, 800, List.of(bot), List.of()),
                List.of(new MatchPlaybackDTO.ReplayFrameDTO(1, 100, List.of(bot), List.of())),
                null,
                null,
                null);

        MatchReplayDTO compact = MatchReplayDTO.from(playback);
        MatchReplayDTO.ReplayBotDTO frameBot = compact.frames().getFirst().bots().getFirst();
        String json = jsonMapper.writeValueAsString(compact);

        assertThat(frameBot.preparingMs()).isEqualTo(450);
        assertThat(frameBot.abilityTargetX()).isEqualTo(720d);
        assertThat(frameBot.abilityTargetY()).isEqualTo(340d);
        assertThat(frameBot.visualOriginX()).isEqualTo(125d);
        assertThat(frameBot.visualOriginY()).isEqualTo(235d);
        assertThat(frameBot.visualOriginRotation()).isEqualTo(35d);
        assertThat(json).contains(
                "\"preparingMs\":450",
                "\"abilityTargetX\":720.0",
                "\"visualOriginX\":125.0");
    }

    @Test
    void replayBatchEnvelopeOmitsUnusedMatchmakingFields() {
        MatchReplayDTO playback = new MatchReplayDTO(
                null,
                List.of(),
                "DRAW",
                null,
                "The fight ended in a draw.",
                null,
                null,
                null);

        String json = jsonMapper.writeValueAsString(MatchmakingEventDTO.replayBatchPayload(
                UUID.randomUUID(),
                "duel-v1",
                playback,
                null,
                null,
                null));

        assertThat(json).contains("\"type\":\"MATCH_REPLAY_BATCH\"", "\"playback\"");
        assertThat(json).doesNotContain(
                "\"players\"",
                "\"entityPlacements\"",
                "\"roundBrains\"",
                "\"abilityOffers\"",
                "\"serverNow\"",
                "\"matchTerminal\"");
    }

    @Test
    void resultPayloadCanCarryTheRecipientRatingChange() {
        MatchReplayDTO playback = new MatchReplayDTO(
                null,
                List.of(),
                "BOT_WIN",
                UUID.randomUUID(),
                "Blue Team wins.",
                null,
                null,
                true,
                null,
                1035,
                1053);

        String json = jsonMapper.writeValueAsString(playback);

        assertThat(json).contains("\"ratingBefore\":1035", "\"ratingAfter\":1053");
    }

    @Test
    void resultPayloadCanCarryAllNamedRatingChanges() {
        MatchReplayDTO playback = new MatchReplayDTO(
                null,
                List.of(),
                "BOT_WIN",
                UUID.randomUUID(),
                "Blue Team wins.",
                null,
                null,
                true,
                null,
                null,
                null)
                .withRatingChanges(List.of(
                        new MatchReplayDTO.RatingChangeDTO("pilot", 1100, 1120),
                        new MatchReplayDTO.RatingChangeDTO("opponent", 1200, 1180)));

        String json = jsonMapper.writeValueAsString(playback);

        assertThat(json).contains(
                "\"ratingChanges\"",
                "\"username\":\"pilot\"",
                "\"before\":1100",
                "\"after\":1120");
    }

    @Test
    void compactReplayKeepsEntityHpNullableWithoutUnboxingEmptyValues() {
        MatchPlaybackDTO playback = new MatchPlaybackDTO(
                UUID.randomUUID(),
                "duel-v1",
                "COMPLETED",
                new MatchPlaybackDTO.ArenaStateDTO(1_000, 800, List.of(), List.of()),
                List.of(new MatchPlaybackDTO.ReplayFrameDTO(
                        1,
                        100,
                        List.of(),
                        List.of(
                                new MatchPlaybackDTO.ArenaEntityDTO("projectile", "projectile", 10, 20, 8, 0, 0),
                                new MatchPlaybackDTO.ArenaEntityDTO("drone", "hunterDrone", 30, 40, 12, 0, 0)))),
                null,
                null,
                null);

        List<MatchReplayDTO.ReplayEntityDTO> entities = MatchReplayDTO.from(playback)
                .frames().getFirst().entities();

        assertThat(entities.get(0).hp()).isNull();
        assertThat(entities.get(1).hp()).isZero();
    }

    @Test
    void compactReplayPreservesEntityArmedStateForPresentation() {
        MatchPlaybackDTO playback = new MatchPlaybackDTO(
                UUID.randomUUID(),
                "duel-v1",
                "COMPLETED",
                new MatchPlaybackDTO.ArenaStateDTO(1_000, 800, List.of(), List.of()),
                List.of(new MatchPlaybackDTO.ReplayFrameDTO(
                        1,
                        100,
                        List.of(),
                        List.of(new MatchPlaybackDTO.ArenaEntityDTO(
                                "gravity",
                                "gravityZone",
                                14,
                                300,
                                240,
                                280,
                                0,
                                0,
                                true,
                                2_000,
                                null,
                                null,
                                null)))),
                null,
                null,
                null);

        MatchReplayDTO.ReplayEntityDTO entity = MatchReplayDTO.from(playback)
                .frames().getFirst().entities().getFirst();

        assertThat(entity.armed()).isTrue();
    }

    @Test
    void compactReplayDoesNotCarryExpiredEntityVisualEvents() {
        MatchPlaybackDTO.ArenaEntityDTO grenade = new MatchPlaybackDTO.ArenaEntityDTO(
                "grenade",
                "grenade",
                4,
                300,
                240,
                30,
                0,
                0,
                true,
                100,
                0d,
                0d,
                0,
                "active",
                200,
                "grenadeExplosion",
                0,
                140);
        MatchPlaybackDTO playback = new MatchPlaybackDTO(
                UUID.randomUUID(),
                "duel-v1",
                "COMPLETED",
                new MatchPlaybackDTO.ArenaStateDTO(1_000, 800, List.of(), List.of()),
                List.of(new MatchPlaybackDTO.ReplayFrameDTO(1, 100, List.of(), List.of(grenade))),
                null,
                null,
                null);

        MatchReplayDTO.ReplayEntityDTO entity = MatchReplayDTO.from(playback)
                .frames().getFirst().entities().getFirst();

        assertThat(entity.visibleMs()).isEqualTo(200);
        assertThat(entity.visualEventType()).isNull();
        assertThat(entity.visualEventMs()).isNull();
        assertThat(entity.visualEventSize()).isNull();
    }
}
