package com.example.botfight.controller;

import com.example.botfight.DTO.PuzzleAdminResponseDTO;
import com.example.botfight.DTO.PuzzleSaveRequestDTO;
import com.example.botfight.service.puzzle.PuzzleNotFoundException;
import com.example.botfight.service.puzzle.PuzzleService;
import com.example.botfight.service.puzzle.PuzzleValidationException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/puzzles")
public class AdminPuzzleController {

    private final PuzzleService puzzleService;

    public AdminPuzzleController(PuzzleService puzzleService) {
        this.puzzleService = puzzleService;
    }

    @PostMapping
    public ResponseEntity<PuzzleAdminResponseDTO> create(
            @RequestBody PuzzleSaveRequestDTO request,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED).body(puzzleService.create(request, authentication));
    }

    @GetMapping("/{puzzleNumber}")
    public PuzzleAdminResponseDTO get(
            @PathVariable long puzzleNumber,
            Authentication authentication) {
        return puzzleService.getForAdmin(puzzleNumber, authentication);
    }

    @PutMapping("/{puzzleNumber}")
    public PuzzleAdminResponseDTO update(
            @PathVariable long puzzleNumber,
            @RequestBody PuzzleSaveRequestDTO request,
            Authentication authentication) {
        return puzzleService.update(puzzleNumber, request, authentication);
    }

    @ExceptionHandler(PuzzleValidationException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(PuzzleValidationException exception) {
        List<String> errors = exception.getErrors();
        return ResponseEntity.badRequest().body(Map.of(
                "message", "Puzzle validation failed",
                "errors", errors));
    }

    @ExceptionHandler(PuzzleNotFoundException.class)
    public ResponseEntity<String> handleNotFound(PuzzleNotFoundException exception) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(exception.getMessage());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, String>> handleAccessDenied() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "Admin role is required"));
    }
}
