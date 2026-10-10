package com.example.botfight.service.match.state;

public enum MatchPhase {
    MATCH_FOUND("MATCH_FOUND"),
    LOADOUT_SELECT("LOADOUT_SELECT"),
    BUILDING("PREP"),
    SIMULATION_LOADING("SIMULATION_LOADING"),
    SIMULATING("SIMULATION_LOADING"),
    REPLAY("SIMULATION_PREPARING"),
    RESULT_READY("RESULT_READY");

    private final String wireStatus;
    MatchPhase(String wireStatus) { this.wireStatus = wireStatus; }
    public String wireStatus() { return wireStatus; }
    /** The immutable model and the stored-session guard use the same transition contract. */
    public void checkTransitionTo(MatchPhase to) {
        boolean legal = this == to || to == MatchPhase.RESULT_READY || switch (this) {
            case MATCH_FOUND -> to == MatchPhase.LOADOUT_SELECT;
            case LOADOUT_SELECT -> to == MatchPhase.BUILDING;
            case BUILDING -> to == MatchPhase.SIMULATION_LOADING;
            case SIMULATION_LOADING -> to == MatchPhase.SIMULATING || to == MatchPhase.REPLAY;
            case SIMULATING -> to == MatchPhase.REPLAY || to == MatchPhase.SIMULATION_LOADING;
            case REPLAY -> to == MatchPhase.LOADOUT_SELECT;
            case RESULT_READY -> false;
        };
        if (!legal) throw new IllegalStateException("Illegal match transition: " + this + " -> " + to);
    }
}
