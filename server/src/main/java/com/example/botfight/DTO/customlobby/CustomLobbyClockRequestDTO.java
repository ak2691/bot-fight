package com.example.botfight.DTO.customlobby;

/** A custom lobby's chess clock: base seconds per player (30-600) and increment per round (0-60). */
public record CustomLobbyClockRequestDTO(Integer baseClockSeconds, Integer incrementSeconds) {
}
