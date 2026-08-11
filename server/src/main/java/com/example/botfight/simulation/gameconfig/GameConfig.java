package com.example.botfight.simulation.gameconfig;

/** A loadout chassis. Ability ownership is validated separately from these shared values. */
public record GameConfig(String id, int maxHp, double moveSpeed) {}
