package com.example.botfight.service.match.loadout;

import com.example.botfight.service.auth.AuthException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Holds the current, server-owned round ability preferences for each player.
 *
 * These choices are intentionally transient: they are a queue/custom-match
 * preference, not part of a completed match's replay or persistent profile.
 */
@Service
public class MatchAbilityGuaranteeService {

    private final Map<UUID, Map<Integer, Integer>> guaranteesByUserId = new HashMap<>();

    public synchronized Map<Integer, Integer> forUser(UUID userId) {
        if (userId == null) return Map.of();
        return guaranteesByUserId.getOrDefault(userId, Map.of());
    }

    public synchronized Map<Integer, Integer> setForUser(
            UUID userId,
            List<Integer> requestedAbilityIds) {
        if (userId == null) {
            throw new AuthException("an authenticated player is required");
        }
        Map<Integer, Integer> normalized = MatchLoadoutService.normalizeAbilityGuarantees(
                requestedAbilityIds);
        if (normalized.isEmpty()) {
            guaranteesByUserId.remove(userId);
        } else {
            guaranteesByUserId.put(userId, normalized);
        }
        return normalized;
    }
}
