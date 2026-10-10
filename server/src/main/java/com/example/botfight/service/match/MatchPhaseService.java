package com.example.botfight.service.match;

import org.springframework.stereotype.Component;

import com.example.botfight.service.match.state.MatchPhase;

/** Legal active-match transitions. Time and event validation live at their boundaries. */
@Component
public final class MatchPhaseService {
    public MatchPhaseService() {}

    public void checkTransition(MatchPhase from, MatchPhase to) {
        from.checkTransitionTo(to);
    }
}
