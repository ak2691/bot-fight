package com.example.botfight.simulation.gameconfig;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Channels (shared/gameplay/channels.json) and per-ability channel/cost data (abilities.json); the browser's
 * gameconfig/AbilityChannels.js reads the same files. A channel is busy while one of its abilities is winding
 * up or active, channels are independent of each other, and the statuses that block a channel are data.
 */
public final class AbilityChannels {
    public static final String ABILITY = "ability";
    public static final String DASH = GameplayData.DASH_CHANNEL;

    private static final Map<Integer, GameplayData.AbilityData> ABILITIES = index();

    private AbilityChannels() {}

    private static Map<Integer, GameplayData.AbilityData> index() {
        Map<Integer, GameplayData.AbilityData> byId = new HashMap<>();
        for (GameplayData.AbilityData ability : GameplayData.get().abilities().abilities()) {
            byId.put(ability.id(), ability);
        }
        return Map.copyOf(byId);
    }

    /** The channel id of an ability, or null for an unknown ability. */
    public static String channel(int abilityId) {
        GameplayData.AbilityData ability = ABILITIES.get(abilityId);
        return ability == null ? null : ability.channel();
    }

    /** Stamina an activation pays; 0 for an ability with no cost. */
    public static int staminaCost(int abilityId) {
        GameplayData.AbilityData ability = ABILITIES.get(abilityId);
        return ability == null || ability.cost() == null || ability.cost().stamina() == null
                ? 0 : ability.cost().stamina();
    }

    /** The status ids that stop a channel's abilities from starting (and cancel their wind-up). */
    public static List<String> blockingStatuses(String channel) {
        GameplayData.ChannelData data = GameplayData.get().channels().channels().get(channel);
        return data == null ? List.of() : data.blockedByStatuses();
    }

    /** The blocking statuses that also report the channel's abilities as not ready (so a brain falls through). */
    public static List<String> notReadyStatuses(String channel) {
        GameplayData.ChannelData data = GameplayData.get().channels().channels().get(channel);
        return data == null ? List.of() : data.notReadyWhileStatuses();
    }

    public static boolean isDash(int abilityId) {
        return DASH.equals(channel(abilityId));
    }
}
