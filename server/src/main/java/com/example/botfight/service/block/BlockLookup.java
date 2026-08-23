package com.example.botfight.service.block;

import java.util.UUID;

/** Directional visibility rule: viewer blocks actor. */
@FunctionalInterface
public interface BlockLookup {

    boolean isBlocked(UUID viewerUserId, UUID actorUserId);

    static BlockLookup none() {
        return (viewerUserId, actorUserId) -> false;
    }
}
