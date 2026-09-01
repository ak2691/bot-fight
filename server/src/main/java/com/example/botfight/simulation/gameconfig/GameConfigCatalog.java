package com.example.botfight.simulation.gameconfig;

import org.springframework.stereotype.Component;
import java.util.List;
import java.util.Set;

/** Shared base rules for duel-v1; equipped loadouts gate individual abilities. */
@Component
public class GameConfigCatalog {
    public static final List<Integer> STANDARD_ABILITY_ORDER = List.of(19, 20, 34);
    public static final Set<Integer> STANDARD_ABILITIES = Set.copyOf(STANDARD_ABILITY_ORDER);
    private static final GameConfig DUEL_V1 = new GameConfig("duel-v1", 150, 15);
    public GameConfig duelV1() {
        return DUEL_V1;
    }

}
