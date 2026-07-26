package com.example.botfight.simulation.combat;

import java.util.List;

/** A loadout chassis. Ability ownership is validated separately from these shared values. */
public record CombatRules(String id, int maxHp, double moveSpeed, boolean swing, boolean block, boolean dash,
        boolean gun, boolean grenade, boolean fireball, boolean stun) {
    public boolean canSwing() { return swing; } public boolean canBlock() { return block; }
    public boolean canDash() { return dash; } public boolean canFireGun() { return gun; }
    public boolean canThrowGrenade() { return grenade; } public boolean canShootFireball() { return fireball; }
    public boolean canStun() { return stun; }
    private static final Moves.MoveDefinition SWING = Moves.definition("swing");
    private static final Moves.MoveDefinition BLOCK = Moves.definition("block");
    private static final Moves.MoveDefinition DASH = Moves.definition("dash");
    private static final Moves.MoveDefinition GUN = Moves.definition("fire_gun");
    private static final Moves.MoveDefinition FIREBALL = Moves.definition("shoot_fireball");
    private static final Abilities.AbilityDefinition GRENADE = Abilities.definition("throw_grenade");
    private static final Abilities.AbilityDefinition STUN = Abilities.definition("stun");

    public int blockMaxCharges() { return BLOCK.charges(); } public int blockRechargeMs() { return BLOCK.rechargeMs(); }
    public int dashCooldownMs() { return DASH.cooldownMs(); }
    public double attackRange() { return SWING.range(); } public double attackArcDegrees() { return SWING.arcDegrees(); }
    public int attackDamage() { return SWING.damage(); } public int gunCooldownMs() { return GUN.cooldownMs(); }
    public int gunActiveMs() { return GUN.activeMs(); } public int gunAmmoMax() { return GUN.charges(); }
    public int gunReloadMs() { return GUN.rechargeMs(); } public double gunRange() { return GUN.range(); }
    public int gunDamage(double distance) {
        List<Moves.DamageAnchor> values = GUN.damageFalloff();
        if (distance <= values.getFirst().distance()) return values.getFirst().damage();
        for (int i = 1; i < values.size(); i++) { var near = values.get(i - 1); var far = values.get(i); if (distance <= far.distance()) { double t = (distance - near.distance()) / (far.distance() - near.distance()); return (int) Math.round(near.damage() + (far.damage() - near.damage()) * t); } }
        return 0;
    }
    public int grenadeCooldownMs() { return GRENADE.cooldownMs(); }
    public int grenadeDamage(double distance) { if (distance > GRENADE.range()) return 0; double t = Math.max(0, distance / GRENADE.range()); return (int) Math.max(20, Math.min(45, Math.round((45 + (20 - 45) * t) / 5) * 5)); }
    public int fireballCooldownMs() { return FIREBALL.cooldownMs(); } public int fireballActiveMs() { return FIREBALL.activeMs(); }
    public int fireballChargesMax() { return FIREBALL.charges(); } public int fireballReloadMs() { return FIREBALL.rechargeMs(); }
    public double fireballRange() { return FIREBALL.range(); } public int fireballDamage() { return FIREBALL.damage(); }
    public int fireballBurnDamage() { return FIREBALL.damageOverTime().damage(); } public int fireballBurnDurationMs() { return FIREBALL.damageOverTime().durationMs(); }
    public int fireballBurnTickMs() { return FIREBALL.damageOverTime().tickMs(); } public int stunCooldownMs() { return STUN.cooldownMs(); }
    public int stunActiveMs() { return STUN.windupMs(); } public int stunDamage() { return STUN.damage(); }
    public int stunDurationMs() { return STUN.durationMs(); } public double stunRange() { return STUN.range(); }
    public double stunArcDegrees() { return STUN.arcDegrees(); }
}
