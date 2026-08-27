package com.example.botfight.DTO;

public record PuzzlePriorityMigrationResponse(
        int puzzleConfigurationsUpdated,
        int puzzleBotBrainsUpdated,
        int matchRoundBotBrainsUpdated) {
}
