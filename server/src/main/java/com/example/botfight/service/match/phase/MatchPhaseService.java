package com.example.botfight.service.match.phase;

import com.example.botfight.DTO.match.MatchmakingEventDTO;
import com.example.botfight.service.match.event.OutboundMatchmakingEvent;
import com.example.botfight.service.match.model.MatchPlayer;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.match.state.CurrentPhase;
import com.example.botfight.service.match.state.MatchPhase;
import com.example.botfight.service.match.state.MatchRuntimeState;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

/** Validates that delayed matchmaking events still describe the live phase. */
public final class MatchPhaseService {
    private final MatchRuntimeState state;
    private final Clock clock;

    public MatchPhaseService(MatchRuntimeState state, Clock clock) {
        this.state = state;
        this.clock = clock;
    }

    public boolean isCurrentEvent(OutboundMatchmakingEvent outbound) {
        return currentEventRejectionReason(outbound) == null;
    }

    /**
     * Returns a diagnostic reason when an outbound event no longer matches the
     * authoritative match phase, or {@code null} when it is current.
     */
    public String currentEventRejectionReason(OutboundMatchmakingEvent outbound) {
        if (outbound == null || outbound.event() == null) {
            return "outbound event or payload is null";
        }
        MatchmakingEventDTO event = outbound.event();
        if (event.matchId() == null || "MATCH_ACCEPT".equals(event.status())) {
            return null;
        }
        if ("MATCH_RESULT_READY".equals(event.type())) {
            return resultReadyRejectionReason(outbound);
        }
        if ("MATCH_ROUND_READY".equals(event.type())) {
            return replayBoundaryRejectionReason(outbound);
        }
        // Connection notifications are match-lifecycle events, not phase
        // snapshots. They remain valid while the active session exists.
        if ("PLAYER_DISCONNECTED".equals(event.type())
                || "PLAYER_RECONNECTED".equals(event.type())) {
            return currentPhaseFor(event.matchId(), outbound.principalName()) != null
                    ? null
                    : "no active session for connection lifecycle event";
        }
        CurrentPhase current = currentPhaseFor(event.matchId(), outbound.principalName());
        MatchPhase eventPhase = phaseForEvent(event);
        if (current == null) return "no active phase for match and principal";
        if (eventPhase == null) return "event type/status does not map to a match phase";
        if (event.roundNumber() != null && event.roundNumber() != current.roundNumber()) {
            return "event round " + event.roundNumber()
                    + " does not match active round " + current.roundNumber();
        }
        if (eventPhase != current.phase()) {
            return "event phase " + eventPhase + " does not match active phase " + current.phase();
        }
        if (eventPhase == MatchPhase.LOADOUT_SELECT
                && current.selectionDeadline() != null
                && event.loadoutSelectionEndsAt() != null
                && !current.selectionDeadline().equals(event.loadoutSelectionEndsAt())) {
            return "selection deadline does not match active deadline"
                    + " (event=" + event.loadoutSelectionEndsAt()
                    + ", active=" + current.selectionDeadline() + ")";
        }
        if ("MATCH_STARTED".equals(event.type())
                && state.initialLoadoutSelectionStartedMatchIds().contains(event.matchId())) {
            return "initial loadout selection already started for match";
        }
        return null;
    }

    private CurrentPhase currentPhaseFor(UUID matchId, String principalName) {
        MatchSession activeSession = activeSessionFor(matchId, principalName);
        if (activeSession == null) return null;
        if (activeSession.isReplay()) {
            Instant now = Instant.now(clock);
            if (activeSession.seriesComplete()
                    && activeSession.resultRevealsAt() != null
                    && !now.isBefore(activeSession.resultRevealsAt())) {
                return new CurrentPhase(
                        MatchPhase.RESULT_READY,
                        activeSession.roundNumber(),
                        null);
            }
            return new CurrentPhase(MatchPhase.REPLAY, activeSession.roundNumber(), null);
        }
        MatchPhase phase = phaseForSession(activeSession);
        Instant selectionDeadline = activeSession.loadoutSelectionEndsAt();
        return new CurrentPhase(phase, activeSession.roundNumber(), selectionDeadline);
    }

    private String replayBoundaryRejectionReason(OutboundMatchmakingEvent outbound) {
        MatchmakingEventDTO event = outbound.event();
        MatchSession activeSession = activeSessionFor(event.matchId(), outbound.principalName());
        if (activeSession == null) return "no active session for round boundary";
        if (!activeSession.isReplay()) {
            CurrentPhase current = currentPhaseFor(event.matchId(), outbound.principalName());
            if (current != null
                    && current.phase() == MatchPhase.LOADOUT_SELECT
                    && event.roundNumber() != null
                    && event.roundNumber() == current.roundNumber()
                    && "LOADOUT_SELECT".equals(event.status())) {
                return null;
            }
            return "active session is not in replay phase";
        }
        if (activeSession.seriesComplete()) {
            return "series is already complete";
        }
        if (event.roundNumber() == null) return "round boundary event has no round number";
        if (event.roundNumber() != activeSession.roundNumber() + 1) {
            return "event round " + event.roundNumber()
                    + " is not the next round after active round " + activeSession.roundNumber();
        }
        if (activeSession.roundReadyAt() == null) {
            return "active replay session has no round-ready time";
        }
        Instant now = Instant.now(clock);
        if (now.isBefore(activeSession.roundReadyAt())) {
            return "round-ready time has not been reached (now=" + now
                    + ", roundReadyAt=" + activeSession.roundReadyAt() + ")";
        }
        return null;
    }

    private String resultReadyRejectionReason(OutboundMatchmakingEvent outbound) {
        MatchmakingEventDTO event = outbound.event();
        MatchSession activeSession = activeSessionFor(event.matchId(), outbound.principalName());
        if (activeSession != null) {
            if (!activeSession.seriesComplete()) {
                return "active session is not in the terminal result phase";
            }
            if (event.roundNumber() != null && event.roundNumber() != activeSession.roundNumber()) {
                return "result event round " + event.roundNumber()
                        + " does not match active round " + activeSession.roundNumber();
            }
            if (activeSession.resultRevealsAt() != null
                    && event.resultRevealsAt() != null
                    && !activeSession.resultRevealsAt().equals(event.resultRevealsAt())) {
                return "result reveal time does not match the active terminal session"
                        + " (event=" + event.resultRevealsAt()
                        + ", active=" + activeSession.resultRevealsAt() + ")";
            }
        }
        Instant resultRevealsAt = event.resultRevealsAt();
        if (resultRevealsAt == null) return null;
        Instant now = Instant.now(clock);
        if (now.isBefore(resultRevealsAt)) {
            return "result reveal time has not been reached (now=" + now
                    + ", resultRevealsAt=" + resultRevealsAt + ")";
        }
        return null;
    }

    private MatchSession activeSessionFor(UUID matchId, String principalName) {
        return state.distinctActiveSessions().stream()
                .filter(session -> session.matchId().equals(matchId))
                .filter(session -> principalName == null || session.players().stream()
                        .anyMatch(player -> principalName.equals(player.principalName())))
                .findFirst()
                .orElse(null);
    }

    private MatchPhase phaseForSession(MatchSession session) {
        if (session.isReplay()) return MatchPhase.REPLAY;
        if (session.players().stream().allMatch(MatchPlayer::finished)) {
            return MatchPhase.SIMULATION_LOADING;
        }
        if (session.countdownEndsAt() != null) return MatchPhase.BUILDING;
        if (session.entityPlacementEndsAt() != null) return MatchPhase.OBJECT_PLACEMENT;
        if (session.loadoutSelectionEndsAt() != null) return MatchPhase.LOADOUT_SELECT;
        return session.roundNumber() == 1
                && !state.initialLoadoutSelectionStartedMatchIds().contains(session.matchId())
                ? MatchPhase.MATCH_FOUND
                : MatchPhase.LOADOUT_SELECT;
    }

    private MatchPhase phaseForEvent(MatchmakingEventDTO event) {
        if ("MATCH_RESULT_READY".equals(event.type())) {
            return MatchPhase.RESULT_READY;
        }
        if ("SIMULATION_PREPARING".equals(event.type())
                || "MATCH_REPLAY_BATCH".equals(event.type())
                || "READY_FOR_PLAYBACK".equals(event.status())
                || "SIMULATION_PREPARING".equals(event.status())) {
            return MatchPhase.REPLAY;
        }
        if ("SIMULATION_LOADING".equals(event.type())
                || "SIMULATION_LOADING".equals(event.status())) {
            return MatchPhase.SIMULATION_LOADING;
        }
        if ("PLAYER_FINISHED".equals(event.type())
                || "WAITING_FOR_FINISH".equals(event.status())
                || "BOT_BUILDING_SESSION_READY".equals(event.type())
                || "PREP".equals(event.status())
                || "BUILDING".equals(event.status())) {
            return MatchPhase.BUILDING;
        }
        if ("OBJECT_PLACEMENT".equals(event.status())) return MatchPhase.OBJECT_PLACEMENT;
        if ("LOADOUT_SELECT".equals(event.status())
                || "MATCH_STARTED".equals(event.type())
                || "MATCH_LOADOUT_SELECTION_READY".equals(event.type())
                || "MATCH_LOADOUT_SELECTED".equals(event.type())
                || "MATCH_ROUND_READY".equals(event.type())
                || "MATCH_SURRENDER_UPDATED".equals(event.type())) {
            return MatchPhase.LOADOUT_SELECT;
        }
        if ("MATCH_FOUND".equals(event.status())) return MatchPhase.MATCH_FOUND;
        return null;
    }
}
