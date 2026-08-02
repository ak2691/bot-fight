package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchStatus;
import com.example.botfight.repository.BotSubmissionRepository;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.MatchRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.repository.ValidationResultRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchPersistenceServiceTest {

    private static final Instant RESTARTED_AT = Instant.parse("2026-07-31T12:00:00Z");

    private final MatchRepository matchRepository = mock(MatchRepository.class);
    private final MatchParticipantRepository matchParticipantRepository = mock(MatchParticipantRepository.class);
    private final BotSubmissionRepository botSubmissionRepository = mock(BotSubmissionRepository.class);
    private final ProfileRepository profileRepository = mock(ProfileRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final ValidationResultRepository validationResultRepository = mock(ValidationResultRepository.class);
    private final MatchPersistenceService service = new MatchPersistenceService(
            matchRepository,
            matchParticipantRepository,
            botSubmissionRepository,
            profileRepository,
            userRepository,
            validationResultRepository,
            Clock.fixed(RESTARTED_AT, ZoneOffset.UTC),
            new JsonMapper());

    @Test
    void cancelsPersistedRunningMatchesWithoutAssigningAnOutcome() {
        Match runningMatch = new Match();
        runningMatch.setStatus(MatchStatus.RUNNING);
        AppUser staleWinner = new AppUser();
        runningMatch.setWinnerUser(staleWinner);
        when(matchRepository.findByStatusOrderByCreatedAtAsc(MatchStatus.RUNNING))
                .thenReturn(List.of(runningMatch));

        int cancelledMatches = service.cancelMatchesInterruptedByServerRestart();

        assertThat(cancelledMatches).isEqualTo(1);
        assertThat(runningMatch.getStatus()).isEqualTo(MatchStatus.CANCELLED);
        assertThat(runningMatch.getCompletionReason())
                .isEqualTo(MatchPersistenceService.COMPLETION_REASON_SERVER_RESTART);
        assertThat(runningMatch.getCompletedAt()).isEqualTo(RESTARTED_AT);
        assertThat(runningMatch.getWinnerUser()).isNull();
        verify(matchRepository).saveAll(List.of(runningMatch));
        verifyNoInteractions(
                matchParticipantRepository,
                profileRepository,
                userRepository,
                validationResultRepository);
    }

    @Test
    void doesNothingWhenNoPersistedMatchWasRunning() {
        when(matchRepository.findByStatusOrderByCreatedAtAsc(MatchStatus.RUNNING))
                .thenReturn(List.of());

        assertThat(service.cancelMatchesInterruptedByServerRestart()).isZero();

        org.mockito.Mockito.verify(matchRepository, org.mockito.Mockito.never())
                .saveAll(any());
    }
}
