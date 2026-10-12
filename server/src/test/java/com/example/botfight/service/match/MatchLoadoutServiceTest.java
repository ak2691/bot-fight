package com.example.botfight.service.match;
import static org.assertj.core.api.Assertions.*;
import com.example.botfight.DTO.match.MatchKitDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.simulation.gameconfig.AbilityCatalog;
import java.util.List;
import org.junit.jupiter.api.Test;
class MatchLoadoutServiceTest {
    @Test void validatesFullKitAndEveryTierCombinationFromTheCatalog() {
        for (int weapon : AbilityCatalog.weaponIds()) {
            String kit = MatchLoadoutService.validateKit(new MatchKitDTO(weapon, List.of(3, 6, 22)));
            assertThat(kit).isEqualTo("custom:" + AbilityCatalog.codeForId(weapon) + "gto");
            assertThat(MatchLoadoutService.validateEncodedKit(kit)).isEqualTo(kit);
        }
    }
    @Test void rejectsWrongTierTwoFromOneTierUnknownMissingAndDuplicateIds() {
        for (MatchKitDTO kit : List.of(new MatchKitDTO(1, List.of(6, 3, 22)),
                new MatchKitDTO(1, List.of(3, 4, 22)), new MatchKitDTO(1, List.of(3, 6, 999)),
                new MatchKitDTO(null, List.of(3, 6, 22)), new MatchKitDTO(19, List.of(3, 6, 22)),
                new MatchKitDTO(1, List.of(3, 3, 22)), new MatchKitDTO(1, List.of(3, 6)))) {
            assertThatThrownBy(() -> MatchLoadoutService.validateKit(kit)).isInstanceOf(AuthException.class).hasMessageContaining("kit");
        }
        for (String kit : List.of("custom:sg??", "custom:sg", "custom:sggr", "melee"))
            assertThatThrownBy(() -> MatchLoadoutService.validateEncodedKit(kit)).isInstanceOf(AuthException.class);
    }
    @Test void onlyOddRoundsUnlockAndGapRoundsRetainTheirSubset() {
        String kit = MatchLoadoutService.validateKit(new MatchKitDTO(1, List.of(3, 6, 22)));
        assertThat(List.of(1,2,3,4,5,6).stream().map(round -> MatchLoadoutService.unlockedLoadout(kit, round)))
            .containsExactly("custom:sg", "custom:sg", "custom:sgt", "custom:sgt", "custom:sgto", "custom:sgto");
        assertThat(MatchLoadoutService.unlockedTier(1)).isEqualTo(1);
        assertThat(MatchLoadoutService.unlockedTier(3)).isEqualTo(2);
        assertThat(MatchLoadoutService.unlockedTier(5)).isEqualTo(3);
        for (int round : List.of(2,4,6)) assertThat(MatchLoadoutService.unlockedTier(round)).isNull();
    }
    @Test void rejectsJsonCoercionAndExtraFieldsAtTheWireBoundary() {
        var mapper = tools.jackson.databind.json.JsonMapper.builder().build();
        assertThat(mapper.readValue("{\"weapon\":1,\"abilities\":[3,6,22]}", MatchKitDTO.class)).isEqualTo(new MatchKitDTO(1,List.of(3, 6, 22)));
        for (String json : List.of("{\"weapon\":\"1\",\"abilities\":[3,6,22]}",
                "{\"weapon\":1.5,\"abilities\":[3,6,22]}", "{\"weapon\":1,\"abilities\":[3,6,\"21\"]}",
                "{\"weapon\":1,\"abilities\":[3,6,22],\"userId\":\"victim\"}"))
            assertThatThrownBy(() -> mapper.readValue(json, MatchKitDTO.class)).hasMessageContaining("kit");
    }

}
