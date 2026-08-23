package com.example.botfight.service.match.state;

import com.example.botfight.DTO.MatchReplayDTO;
import java.util.List;

public record PreparedReplay(
        MatchReplayDTO replayPlayback,
        MatchReplayDTO fullReplay,
        int replayDurationMillis,
        List<PreparedReplayBatch> batches) {
}
