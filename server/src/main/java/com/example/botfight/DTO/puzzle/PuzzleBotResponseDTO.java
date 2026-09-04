package com.example.botfight.DTO.puzzle;

import java.util.UUID;
import tools.jackson.databind.JsonNode;

public class PuzzleBotResponseDTO {
    private UUID id;
    private String role;
    private int teamNumber;
    private int slot;
    private String loadout;
    private double startX;
    private double startY;
    private double rotation;
    private double startHp;
    private JsonNode brain;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }

    public int getTeamNumber() { return teamNumber; }
    public void setTeamNumber(int teamNumber) { this.teamNumber = teamNumber; }

    public int getSlot() { return slot; }
    public void setSlot(int slot) { this.slot = slot; }

    public String getLoadout() { return loadout; }
    public void setLoadout(String loadout) { this.loadout = loadout; }

    public double getStartX() { return startX; }
    public void setStartX(double startX) { this.startX = startX; }

    public double getStartY() { return startY; }
    public void setStartY(double startY) { this.startY = startY; }

    public double getRotation() { return rotation; }
    public void setRotation(double rotation) { this.rotation = rotation; }

    public double getStartHp() { return startHp; }
    public void setStartHp(double startHp) { this.startHp = startHp; }

    public JsonNode getBrain() { return brain; }
    public void setBrain(JsonNode brain) { this.brain = brain; }
}
