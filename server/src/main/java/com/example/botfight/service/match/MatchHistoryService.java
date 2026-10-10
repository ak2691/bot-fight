package com.example.botfight.service.match;

import org.springframework.stereotype.Component;

import com.example.botfight.DTO.match.MatchmakingEventDTO.RoundBrainDTO;
import com.example.botfight.domain.submission.BotSubmission;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.state.MatchRuntimeState;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public final class MatchHistoryService {
    private final MatchRuntimeState state;
    private final JsonMapper jsonMapper;
    public MatchHistoryService(MatchRuntimeState state, JsonMapper jsonMapper) {
        this.state = state;
        this.jsonMapper = jsonMapper;
    }
    public List<RoundBrainDTO> roundBrainsForPlayer(UUID matchId, UUID userId) {
        return state.roundHistoryByMatchId().getOrDefault(matchId, List.of()).stream()
                .map(round -> {
                    BotSubmission submission = round.submissionsByUser().get(userId);
                    if (submission == null) return null;
                    return new RoundBrainDTO(round.roundNumber(),
                readSubmissionBrain(submission));
                })
                .filter(round -> round != null)
                .toList();
    }

    private JsonNode readSubmissionBrain(BotSubmission submission) {
        try {
            return jsonMapper.readTree(submission.getBrainPayload());
        } catch (Exception exception) {
            throw new AuthException("submitted brain could not be read");
        }
    }

}
