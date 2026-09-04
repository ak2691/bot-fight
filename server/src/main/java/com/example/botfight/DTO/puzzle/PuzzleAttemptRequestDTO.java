package com.example.botfight.DTO.puzzle;

import tools.jackson.databind.JsonNode;

/** Player-controlled brain submitted for one authoritative puzzle attempt. */
public class PuzzleAttemptRequestDTO {
    private JsonNode brain;

    public JsonNode getBrain() { return brain; }
    public void setBrain(JsonNode brain) { this.brain = brain; }
}
