package com.example.botfight.service.block;

import com.example.botfight.DTO.block.BlockStatusDTO;
import com.example.botfight.domain.auth.AppUser;
import com.example.botfight.repository.UserBlockRepository;
import com.example.botfight.repository.UserRepository;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.auth.UsernamePolicy;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserBlockService implements BlockLookup {

    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final UserBlockRepository userBlockRepository;

    public UserBlockService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            UserBlockRepository userBlockRepository) {
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.userBlockRepository = userBlockRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isBlocked(UUID viewerUserId, UUID actorUserId) {
        if (viewerUserId == null || actorUserId == null || viewerUserId.equals(actorUserId)) {
            return false;
        }
        return userBlockRepository.existsByBlockerIdAndBlockedId(viewerUserId, actorUserId);
    }

    @Transactional
    public BlockStatusDTO block(Authentication authentication, String requestedUsername) {
        AppUser blocker = currentUserService.requireCurrentUser(authentication);
        AppUser blocked = findVerifiedUser(requestedUsername);
        rejectSelf(blocker, blocked);
        userBlockRepository.insertIfAbsent(blocker.getId(), blocked.getId());
        return new BlockStatusDTO(true);
    }

    @Transactional
    public BlockStatusDTO unblock(Authentication authentication, String requestedUsername) {
        UUID blockerId = currentUserService.requireCurrentUserId(authentication);
        AppUser blocked = findVerifiedUser(requestedUsername);
        if (blockerId.equals(blocked.getId())) {
            throw new AuthException("you cannot unblock yourself");
        }
        userBlockRepository.deleteByBlockerIdAndBlockedId(blockerId, blocked.getId());
        return new BlockStatusDTO(false);
    }

    @Transactional(readOnly = true)
    public BlockStatusDTO status(Authentication authentication, String requestedUsername) {
        UUID blockerId = currentUserService.requireCurrentUserId(authentication);
        AppUser blocked = findVerifiedUser(requestedUsername);
        if (blockerId.equals(blocked.getId())) {
            return new BlockStatusDTO(false);
        }
        return new BlockStatusDTO(isBlocked(blockerId, blocked.getId()));
    }

    private AppUser findVerifiedUser(String requestedUsername) {
        String username = UsernamePolicy.clean(requestedUsername);
        UsernamePolicy.validate(username);
        return userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(username)
                .orElseThrow(() -> new AuthException("player could not be found"));
    }

    private void rejectSelf(AppUser blocker, AppUser blocked) {
        if (blocker.getId().equals(blocked.getId())) {
            throw new AuthException("you cannot block yourself");
        }
    }
}
