package com.example.botfight.service.puzzle;

public class PuzzleNotFoundException extends RuntimeException {

    public PuzzleNotFoundException(long puzzleNumber) {
        super("Puzzle not found: " + puzzleNumber);
    }
}
