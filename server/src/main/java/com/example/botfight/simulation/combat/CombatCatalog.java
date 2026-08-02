package com.example.botfight.simulation.combat;

import org.springframework.stereotype.Component;

/** Shared base rules for duel-v1; equipped loadouts gate individual moves and abilities. */
@Component
public class CombatCatalog {
    private static final CombatRules DUEL_V1 = new CombatRules("duel-v1", 100, 8, true, true, true, true, true, true, true);
    // Boundary-only replay compatibility for submissions created before loadout-owned rules.
    private static final CombatRules LEGACY_MELEE = new CombatRules("melee", 125, 12, true, true, true, false, false, false, false);
    private static final CombatRules LEGACY_RANGED = new CombatRules("ranged", 90, 8, false, false, false, true, true, false, false);
    private static final CombatRules LEGACY_MAGE = new CombatRules("mage", 100, 10, false, false, false, false, false, true, true);
    public CombatRules duelV1() {
        return DUEL_V1;
    }

    public CombatRules forSubmittedLoadout(String id) {
        return switch (id == null ? "custom" : id) {
            case "melee" -> LEGACY_MELEE;
            case "ranged" -> LEGACY_RANGED;
            case "mage" -> LEGACY_MAGE;
            default -> DUEL_V1;
        };
    }
}
