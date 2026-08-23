package com.example.botfight.DTO;

import tools.jackson.databind.JsonNode;

public class PuzzleBotRequestDTO {
    private String loadout;
    private Double startX;
    private Double startY;
    private Double rotation;
    private Double startHp;
    private JsonNode brain;

    public String getLoadout() { return loadout; }
    public void setLoadout(String loadout) { this.loadout = loadout; }

    public Double getStartX() { return startX; }
    public void setStartX(Double startX) { this.startX = startX; }

    public Double getStartY() { return startY; }
    public void setStartY(Double startY) { this.startY = startY; }

    public Double getRotation() { return rotation; }
    public void setRotation(Double rotation) { this.rotation = rotation; }

    public Double getStartHp() { return startHp; }
    public void setStartHp(Double startHp) { this.startHp = startHp; }

    public JsonNode getBrain() { return brain; }
    public void setBrain(JsonNode brain) { this.brain = brain; }
}
