package com.example.botfight.controller;

import com.example.botfight.DTO.puzzle.PuzzleAttemptRequestDTO;
import com.example.botfight.DTO.puzzle.PuzzleAttemptResponseDTO;
import com.example.botfight.DTO.puzzle.PuzzleListPageDTO;
import com.example.botfight.DTO.puzzle.PuzzlePlayResponseDTO;
import com.example.botfight.service.puzzle.PuzzleAttemptService;
import com.example.botfight.service.puzzle.PuzzleService;
import com.example.botfight.service.puzzle.PuzzleNotFoundException;
import com.example.botfight.service.puzzle.PuzzleValidationException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/puzzles")
public class PuzzleController {

    private final PuzzleService puzzleService;
    private final PuzzleAttemptService puzzleAttemptService;

    public PuzzleController(PuzzleService puzzleService, PuzzleAttemptService puzzleAttemptService) {
        this.puzzleService = puzzleService;
        this.puzzleAttemptService = puzzleAttemptService;
    }

    @GetMapping
    public PuzzleListPageDTO list(
            Authentication authentication,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "") String query) {
        return puzzleService.listPublished(page, size, query, authentication);
    }

    @GetMapping("/{puzzleNumber}")
    public PuzzlePlayResponseDTO get(
            Authentication authentication,
            @PathVariable long puzzleNumber) {
        return puzzleService.getPublished(puzzleNumber, authentication);
    }

    @PostMapping("/{puzzleNumber}/attempt")
    public PuzzleAttemptResponseDTO attempt(
            Authentication authentication,
            @PathVariable long puzzleNumber,
            @RequestBody PuzzleAttemptRequestDTO request) {
        return puzzleAttemptService.attempt(authentication, puzzleNumber, request);
    }

    @ExceptionHandler(PuzzleValidationException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(PuzzleValidationException exception) {
        List<String> errors = exception.getErrors();
        return ResponseEntity.badRequest().body(Map.of(
                "message", "Puzzle attempt validation failed",
                "errors", errors));
    }

    @ExceptionHandler(PuzzleNotFoundException.class)
    public ResponseEntity<String> handleNotFound(PuzzleNotFoundException exception) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(exception.getMessage());
    }
}
