package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.Match;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.repository.MatchParticipantRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;

class ProfileServiceTest {

    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final MatchParticipantRepository participantRepository = mock(MatchParticipantRepository.class);
    private final ProfileService service = new ProfileService(currentUserService, participantRepository);

    @Test
    void returnsOwnedAggregate() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(participantRepository.countByUserIdAndResult(user.getId(), MatchResult.WIN)).thenReturn(7L);
        when(participantRepository.countByUserIdAndResultIn(
                user.getId(),
                List.of(MatchResult.LOSS, MatchResult.FORFEIT))).thenReturn(3L);
        when(participantRepository.countByUserIdAndResult(user.getId(), MatchResult.DRAW)).thenReturn(2L);
        var profile = service.currentProfile(authentication);

        assertThat(profile.username()).isEqualTo("allan");
        assertThat(profile.matchesPlayed()).isEqualTo(12);
        assertThat(profile.wins()).isEqualTo(7);
        assertThat(profile.losses()).isEqualTo(3);
        assertThat(profile.draws()).isEqualTo(2);
    }

    @Test
    void returnsTwentyMatchPagesWithOpponentAndDateFilters() {
        Authentication authentication = mock(Authentication.class);
        AppUser user = user("allan");
        AppUser opponent = user("ByteBrawler");
        Match match = new Match();
        match.setId(UUID.randomUUID());
        match.setCompletedAt(Instant.parse("2026-07-22T10:15:00Z"));
        match.setCompletionReason("SIMULATION");
        MatchParticipant mine = participant(match, user, MatchResult.WIN);
        MatchParticipant theirs = participant(match, opponent, MatchResult.LOSS);
        Instant from = Instant.parse("2026-07-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-01T00:00:00Z");
        PageRequest pageRequest = PageRequest.of(
                0,
                20,
                Sort.by(Sort.Direction.DESC, "match.completedAt"));

        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);
        when(participantRepository.findAll(any(Specification.class), eq(pageRequest)))
                .thenReturn(new PageImpl<>(List.of(mine), pageRequest, 21));
        when(participantRepository.findByMatchId(match.getId())).thenReturn(List.of(mine, theirs));

        var history = service.matchHistory(authentication, 0, " byte ", from, to);

        assertThat(history.pageSize()).isEqualTo(20);
        assertThat(history.hasMore()).isTrue();
        assertThat(history.totalMatches()).isEqualTo(21);
        assertThat(history.matches()).singleElement().satisfies(recent -> {
            assertThat(recent.opponentUsername()).isEqualTo("ByteBrawler");
            assertThat(recent.result()).isEqualTo("WIN");
            assertThat(recent.completedAt()).isEqualTo(Instant.parse("2026-07-22T10:15:00Z"));
        });
    }

    private static AppUser user(String username) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        return user;
    }

    private static MatchParticipant participant(Match match, AppUser user, MatchResult result) {
        MatchParticipant participant = new MatchParticipant();
        participant.setMatch(match);
        participant.setUser(user);
        participant.setResult(result);
        return participant;
    }
}
