package com.example.botfight.DTO;

public class PuzzleAttemptResponseDTO {
    private String status;
    private int elapsedMs;
    private String message;

    public PuzzleAttemptResponseDTO() {}

    public PuzzleAttemptResponseDTO(String status, int elapsedMs, String message) {
        this.status = status;
        this.elapsedMs = elapsedMs;
        this.message = message;
    }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public int getElapsedMs() { return elapsedMs; }
    public void setElapsedMs(int elapsedMs) { this.elapsedMs = elapsedMs; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
}
