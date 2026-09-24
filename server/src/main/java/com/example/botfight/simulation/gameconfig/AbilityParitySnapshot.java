package com.example.botfight.simulation.gameconfig;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import tools.jackson.databind.json.JsonMapper;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only development entry point used by the ability authoring MCP to inspect
 * the same catalogs loaded by the authoritative runtime.
 */
public final class AbilityParitySnapshot {
    private AbilityParitySnapshot() {}

    public static void main(String[] args) throws Exception {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("schemaVersion", 1);
        snapshot.put("registry", AbilityRegistry.all());
        snapshot.put("timing", Abilities.CATALOG);
        snapshot.put("contracts", AbilityContracts.all());
        new JsonMapper().writeValue(System.out, snapshot);
        System.out.println();
    }
}
