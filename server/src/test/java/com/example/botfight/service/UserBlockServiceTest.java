package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.BlockStatusDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.repository.UserBlockRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.block.UserBlockService;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.Authentication;

class UserBlockServiceTest {

    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final UserBlockRepository userBlockRepository = mock(UserBlockRepository.class);
    private final UserBlockService service = new UserBlockService(
            currentUserService,
            userRepository,
            userBlockRepository);

    @Test
    void blockCreatesOnlyTheDirectionalRelationship() {
        Authentication authentication = mock(Authentication.class);
        AppUser blocker = user("alice");
        AppUser blocked = user("bob");
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(blocker);
        when(userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue("bob"))
                .thenReturn(Optional.of(blocked));

        BlockStatusDTO result = service.block(authentication, " bob ");

        assertThat(result.blocked()).isTrue();
        verify(userBlockRepository).insertIfAbsent(blocker.getId(), blocked.getId());
    }

    @Test
    void lookupUsesViewerThenActorAndDoesNotBlockSelf() {
        UUID viewerId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        when(userBlockRepository.existsByBlockerIdAndBlockedId(viewerId, actorId)).thenReturn(true);

        assertThat(service.isBlocked(viewerId, actorId)).isTrue();
        assertThat(service.isBlocked(viewerId, viewerId)).isFalse();
        verify(userBlockRepository).existsByBlockerIdAndBlockedId(eq(viewerId), eq(actorId));
    }

    private static AppUser user(String username) {
        AppUser user = new AppUser();
        user.setId(UUID.randomUUID());
        user.setUsername(username);
        user.setEmail(username + "@example.test");
        return user;
    }
}
