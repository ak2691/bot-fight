package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotLogicContracts;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;

/** Authoritative mirror of frontend abilityBaseRange.test.js; keep the table in step. */
class AbilityBaseRangeParityTest {
    private static final Map<Integer, Double> EXPECTED = expected();

    private static Map<Integer, Double> expected() {
        Map<Integer, Double> table = new LinkedHashMap<>();
        double[][] rows = {
                {1, 92}, {3, 1200}, {4, 320}, {5, 700}, {6, 184}, {7, 115}, {9, 500}, {11, 176},
                {12, 500}, {13, 900}, {14, 220}, {15, 1800}, {18, 220}, {25, 100}, {28, 400},
                {30, 600}, {32, 500}, {34, 80}, {35, 190}, {36, 112}, {37, 125}};
        for (double[] row : rows) table.put((int) row[0], row[1]);
        for (int none : new int[] {8, 10, 16, 17, 19, 20, 21, 22, 23, 24, 26, 27, 29, 31, 33}) table.put(none, null);
        return table;
    }

    @Test
    void oneValuePerHitboxType() {
        assertThat(AbilityBaseRange.of(1).getAsDouble()).isEqualTo(92);   // arc -> range
        assertThat(AbilityBaseRange.of(35).getAsDouble()).isEqualTo(190); // rectangle -> length
        assertThat(AbilityBaseRange.of(3).getAsDouble()).isEqualTo(1200); // ray -> range
        assertThat(AbilityBaseRange.of(5).getAsDouble()).isEqualTo(700);  // projectile: 50 x (1400 / 100)
        assertThat(AbilityBaseRange.of(8)).isEmpty();                     // circle: radius, not range
        assertThat(AbilityBaseRange.of(19)).isEmpty();                    // movement only
        assertThat(AbilityBaseRange.of(999)).isEmpty();
    }

    @Test
    void parityTableCoversEveryAbilityId() {
        assertThat(new TreeSet<>(EXPECTED.keySet())).isEqualTo(new TreeSet<>(AbilityContracts.actions()));
        EXPECTED.forEach((id, range) -> {
            var actual = AbilityBaseRange.of(id);
            if (range == null) assertThat(actual).as("ability %d", id).isEmpty();
            else assertThat(actual.getAsDouble()).as("ability %d", id).isEqualTo(range);
        });
    }

    @Test
    void baseRangeIsABoundedAbilityVariable() {
        var variable = BotLogicContracts.variableContract("bot.selectedAbilityBaseRange");
        assertThat(variable.requiresAbility()).isTrue();
        assertThat(variable.valueType()).isEqualTo(BotLogicContracts.ValueType.NUMBER);
        assertThat(variable.selectableIdentities()).containsExactly(BotLogicContracts.SelectableIdentity.BOT);
        EXPECTED.values().stream().filter(range -> range != null)
                .forEach(range -> assertThat(variable.numericRange().contains(range)).isTrue());
    }
}
