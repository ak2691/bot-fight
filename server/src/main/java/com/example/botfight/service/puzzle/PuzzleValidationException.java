package com.example.botfight.service.puzzle;

import java.util.List;

public class PuzzleValidationException extends RuntimeException {
    private final List<String> errors;

    public PuzzleValidationException(List<String> errors) {
        super(errors == null || errors.isEmpty() ? "puzzle validation failed" : errors.get(0));
        this.errors = errors == null ? List.of("puzzle validation failed") : List.copyOf(errors);
    }

    public List<String> getErrors() {
        return errors;
    }
}
