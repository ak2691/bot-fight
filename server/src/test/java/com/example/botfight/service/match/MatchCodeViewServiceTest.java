package com.example.botfight.service.match;

import com.example.botfight.service.match.model.MatchEntrant;


import com.example.botfight.DTO.match.MatchEventType;

import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import static com.example.botfight.support.WorkerReplayFixtures.*;
import com.example.botfight.DTO.match.MatchCodeViewResponseDTO;
import com.example.botfight.domain.match.MatchMode;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.match.model.*;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.limits.RateLimitExceededException;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class MatchCodeViewServiceTest extends MatchWorkflowFixture {
    @Test
    void codeViewUsesAOneShotReadOnlySnapshotAndPerRequesterRateLimit() {
        UUID requesterId = UUID.randomUUID();
        UUID teammateUserId = UUID.randomUUID();
        UUID opponentUserId = UUID.randomUUID();
        UUID opponentTwoUserId = UUID.randomUUID();
        service.startTeamMatch(List.of(
                com.example.botfight.support.TestKits.entrant(requesterId, "pilot-one", "pilot-one@example.com", "socket-one", 1),
                com.example.botfight.support.TestKits.entrant(teammateUserId, "pilot-teammate", "pilot-teammate@example.com", "socket-two", 1),
                com.example.botfight.support.TestKits.entrant(opponentUserId, "pilot-two", "pilot-two@example.com", "socket-three", 2),
                com.example.botfight.support.TestKits.entrant(opponentTwoUserId, "pilot-two-b", "pilot-two-b@example.com", "socket-four", 2)), MatchMode.TWOS, MatchMode.TWOS != MatchMode.CUSTOM, null, null);
        UUID matchId = savedMatch.getId();

        assertThatThrownBy(() -> codeView.requestCodeView(
                requesterId, matchId, opponentUserId, 1))
                .isInstanceOf(AuthException.class)
                .hasMessage("you can only view real code from a teammate");

        OutboundMatchmakingEvent request = codeView.requestCodeView(
                requesterId, matchId, teammateUserId, 1);

        assertThat(request.principalName()).isEqualTo("pilot-teammate@example.com");
        assertThat(request.event().type()).isEqualTo(MatchEventType.MATCH_CODE_VIEW_REQUEST);
        assertThat(request.event().codeViewRequestId()).isNotNull();
        assertThat(request.event().codeViewTargetUserId()).isEqualTo(teammateUserId);

        tools.jackson.databind.JsonNode brain = new tools.jackson.databind.json.JsonMapper()
                .createObjectNode()
                .put("version", "bot-logic-tree-v2");
        OutboundMatchmakingEvent result = codeView.respondCodeView(
                teammateUserId,
                new MatchCodeViewResponseDTO(
                        request.event().codeViewRequestId(),
                        matchId,
                        teammateUserId,
                        1,
                        brain,
                        "melee"));

        assertThat(result.principalName()).isEqualTo("pilot-one@example.com");
        assertThat(result.event().type()).isEqualTo(MatchEventType.MATCH_CODE_VIEW_RESULT);
        assertThat(result.event().codeViewTargetUserId()).isEqualTo(teammateUserId);
        assertThat(result.event().codeViewBrain()).isEqualTo(brain);
        assertThat(result.event().codeViewSelectedLoadout()).isEqualTo("melee");

        assertThatThrownBy(() -> codeView.requestCodeView(requesterId, matchId, teammateUserId, 1))
                .isInstanceOf(RateLimitExceededException.class);
    }
}
