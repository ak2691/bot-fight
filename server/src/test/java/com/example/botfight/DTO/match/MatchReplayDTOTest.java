package com.example.botfight.DTO.match;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static com.example.botfight.support.WorkerReplayFixtures.*;
class MatchReplayDTOTest {
    @Test void ratingsAndScoresPreserveRawRenderJson() {
        var base = replay("CONTINUES", null, null, "SEGMENT_END", List.of(), List.of(100));
        var scored = new MatchReplayDTO(base.result(), null, base.message(), 1, 100, true,
                Map.of(UUID.randomUUID(), 1)).withWorkerReplay(base.workerReplay())
                .withRatingChange(1200,1210).withRatingChanges(List.of(new MatchReplayDTO.RatingChangeDTO("pilot",1200,1210)));
        var json = new JsonMapper().readTree(new JsonMapper().writeValueAsString(scored));
        assertThat(json.path("frames").get(0).path("elapsedMs").asInt()).isEqualTo(100);
        assertThat(scored.workerReplay()).isSameAs(base.workerReplay());
        assertThat(json.path("ratingBefore").asInt()).isEqualTo(1200);
        assertThat(json.has("workerReplay")).isFalse();
        assertThat(json.path("roundWinsBeforeResult").size()).isEqualTo(1);
    }
    @Test void resultNotificationsHaveNoSimulationFrames() {
        var id = UUID.randomUUID();
        var replay = MatchReplayDTO.from(new MatchPlaybackDTO(UUID.randomUUID(),"duel-v3","COMPLETED","RESIGNATION_WIN",id,"winner"));
        var json = new JsonMapper().readTree(new JsonMapper().writeValueAsString(replay));
        assertThat(replay.winnerUserId()).isEqualTo(id);
        assertThat(json.path("frames").isEmpty()).isTrue();
        assertThat(json.has("initialState")).isFalse();
    }
}
