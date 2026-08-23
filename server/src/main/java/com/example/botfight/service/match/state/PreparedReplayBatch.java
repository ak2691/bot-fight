package com.example.botfight.service.match.state;

import com.example.botfight.DTO.MatchReplayDTO;

public record PreparedReplayBatch(
        MatchReplayDTO playback,
        boolean terminalBatch) {
}
