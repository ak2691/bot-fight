package com.example.botfight.simulation.gameconfig;

import org.springframework.stereotype.Component;
import java.util.Set;

/** Shared base rules for duel-v1; equipped loadouts gate individual abilities. */
@Component
public class GameConfigCatalog {
    public static final Set<Integer> STANDARD_ABILITIES = Set.of(19, 20);
    private static final GameConfig DUEL_V1 = new GameConfig("duel-v1", 100, 8);
    public GameConfig duelV1() {
        return DUEL_V1;
    }

}
