package com.example.botfight.DTO;

import tools.jackson.databind.JsonNode;

public class PuzzleSaveRequestDTO {
    private String name;
    private String description;
    private Boolean published;
    private Boolean hideOpponentCode = true;
    private Integer initialElapsedMs = 0;
    private Integer timeLimitMs = 90_000;
    private Integer maxActionNodes = 100;
    private Integer maxConditionNodes = 300;
    private Integer maxCustomVariables = 100;
    private JsonNode logicConfiguration;
    private JsonNode winConditions;
    private JsonNode loseConditions;
    private PuzzleBotRequestDTO playerBot;
    private PuzzleBotRequestDTO opponentBot;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public Boolean getPublished() { return published; }
    public void setPublished(Boolean published) { this.published = published; }

    public Boolean getHideOpponentCode() { return hideOpponentCode; }
    public void setHideOpponentCode(Boolean hideOpponentCode) { this.hideOpponentCode = hideOpponentCode; }

    public Integer getInitialElapsedMs() { return initialElapsedMs; }
    public void setInitialElapsedMs(Integer initialElapsedMs) { this.initialElapsedMs = initialElapsedMs; }

    public Integer getTimeLimitMs() { return timeLimitMs; }
    public void setTimeLimitMs(Integer timeLimitMs) { this.timeLimitMs = timeLimitMs; }

    public Integer getMaxActionNodes() { return maxActionNodes; }
    public void setMaxActionNodes(Integer maxActionNodes) { this.maxActionNodes = maxActionNodes; }

    public Integer getMaxConditionNodes() { return maxConditionNodes; }
    public void setMaxConditionNodes(Integer maxConditionNodes) { this.maxConditionNodes = maxConditionNodes; }

    public Integer getMaxCustomVariables() { return maxCustomVariables; }
    public void setMaxCustomVariables(Integer maxCustomVariables) { this.maxCustomVariables = maxCustomVariables; }

    public JsonNode getLogicConfiguration() { return logicConfiguration; }
    public void setLogicConfiguration(JsonNode logicConfiguration) { this.logicConfiguration = logicConfiguration; }

    public JsonNode getWinConditions() { return winConditions; }
    public void setWinConditions(JsonNode winConditions) { this.winConditions = winConditions; }

    public JsonNode getLoseConditions() { return loseConditions; }
    public void setLoseConditions(JsonNode loseConditions) { this.loseConditions = loseConditions; }

    public PuzzleBotRequestDTO getPlayerBot() { return playerBot; }
    public void setPlayerBot(PuzzleBotRequestDTO playerBot) { this.playerBot = playerBot; }

    public PuzzleBotRequestDTO getOpponentBot() { return opponentBot; }
    public void setOpponentBot(PuzzleBotRequestDTO opponentBot) { this.opponentBot = opponentBot; }
}
