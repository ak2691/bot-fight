package com.example.botfight.service.match.model;

import com.example.botfight.DTO.match.MatchReplayDTO;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The round 6 tiebreak. When the last segment ends with more than one team still alive, the team with
 * the higher total HP wins; equal totals are a draw. A knockout is not an HP decision.
 *
 * @param teamHp total HP of each team's bots at the end of the segment, by team number
 * @param winningTeam the higher team, or null when the totals are equal
 */
public record HpDecision(Map<Integer, Double> teamHp, Integer winningTeam) {
    private static final double EQUAL_EPSILON = 1e-6;

    /** Returns the decision for a segment's final bot states, or null if at most one team is alive. */
    public static HpDecision fromEndState(List<MatchReplayDTO.ReplayBotDTO> finalBots) {
        if (finalBots == null || finalBots.isEmpty()) return null;
        Map<Integer, Double> hpByTeam = new TreeMap<>();
        long aliveTeams = finalBots.stream()
                .filter(bot -> bot.hp() > 0)
                .map(MatchReplayDTO.ReplayBotDTO::teamNumber)
                .distinct()
                .count();
        if (aliveTeams <= 1) return null;
        for (MatchReplayDTO.ReplayBotDTO bot : finalBots) {
            hpByTeam.merge(bot.teamNumber(), Math.max(0.0, bot.hp()), Double::sum);
        }
        double best = hpByTeam.values().stream().mapToDouble(Double::doubleValue).max().orElse(0.0);
        List<Integer> leaders = hpByTeam.entrySet().stream()
                .filter(entry -> Math.abs(entry.getValue() - best) < EQUAL_EPSILON)
                .map(Map.Entry::getKey)
                .toList();
        return new HpDecision(Map.copyOf(hpByTeam), leaders.size() == 1 ? leaders.getFirst() : null);
    }
}
