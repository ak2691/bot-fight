package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.puzzle.PuzzleAttemptRequestDTO;
import com.example.botfight.DTO.puzzle.PuzzleListPageDTO;
import com.example.botfight.service.puzzle.PuzzleAttemptService;
import com.example.botfight.service.puzzle.PuzzleService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;

class PuzzleControllerTest {
    private final PuzzleService puzzleService = mock(PuzzleService.class);
    private final PuzzleAttemptService attemptService = mock(PuzzleAttemptService.class);

    private static Authentication user(String role) {
        return new UsernamePasswordAuthenticationToken("someone", "n/a", List.of(new SimpleGrantedAuthority(role)));
    }

    private void assertNotFound(Runnable call) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void publicPuzzleEndpointsAreNotFoundForNonAdminsWhileTheFlagIsOff() {
        PuzzleController controller = new PuzzleController(puzzleService, attemptService, false);
        Authentication player = user("ROLE_USER");

        assertNotFound(() -> controller.list(player, 0, 20, ""));
        assertNotFound(() -> controller.get(player, 7));
        assertNotFound(() -> controller.attempt(player, 7, new PuzzleAttemptRequestDTO()));
        assertNotFound(() -> controller.list(null, 0, 20, ""));
        verifyNoInteractions(puzzleService, attemptService);
    }

    @Test
    void adminsStillReachThePuzzlesWhileTheFlagIsOff() {
        PuzzleController controller = new PuzzleController(puzzleService, attemptService, false);
        Authentication admin = user("ROLE_ADMIN");
        PuzzleListPageDTO page = mock(PuzzleListPageDTO.class);
        when(puzzleService.listPublished(0, 20, "", admin)).thenReturn(page);

        assertThat(controller.list(admin, 0, 20, "")).isSameAs(page);
        controller.get(admin, 7);
        verify(puzzleService).getPublished(7, admin);
    }

    @Test
    void turningTheFlagOnRestoresThePublicEndpoints() {
        PuzzleController controller = new PuzzleController(puzzleService, attemptService, true);
        Authentication player = user("ROLE_USER");
        PuzzleListPageDTO page = mock(PuzzleListPageDTO.class);
        when(puzzleService.listPublished(0, 20, "", player)).thenReturn(page);

        assertThat(controller.list(player, 0, 20, "")).isSameAs(page);
        controller.get(player, 7);
        verify(puzzleService).getPublished(7, player);
    }
}
