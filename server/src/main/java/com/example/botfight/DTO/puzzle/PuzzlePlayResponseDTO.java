package com.example.botfight.DTO.puzzle;

import java.util.List;
import tools.jackson.databind.JsonNode;

public class PuzzlePlayResponseDTO {
    private Long puzzleNumber;
    private boolean solved;
    private String name;
    private String description;
    private int initialElapsedMs;
    private boolean hideOpponentCode;
    private int timeLimitMs;
    private int maxActionNodes;
    private int maxConditionNodes;
    private int maxCustomVariables;
    private int playerTeamSize;
    private int opponentTeamSize;
    private JsonNode logicConfiguration;
    private JsonNode winConditions;
    private JsonNode loseConditions;
    private List<PuzzleBotResponseDTO> bots;

    public Long getPuzzleNumber() { return puzzleNumber; }
    public void setPuzzleNumber(Long puzzleNumber) { this.puzzleNumber = puzzleNumber; }

    public boolean isSolved() { return solved; }
    public void setSolved(boolean solved) { this.solved = solved; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public int getInitialElapsedMs() { return initialElapsedMs; }
    public void setInitialElapsedMs(int initialElapsedMs) { this.initialElapsedMs = initialElapsedMs; }

    public boolean isHideOpponentCode() { return hideOpponentCode; }
    public void setHideOpponentCode(boolean hideOpponentCode) { this.hideOpponentCode = hideOpponentCode; }

    public int getTimeLimitMs() { return timeLimitMs; }
    public void setTimeLimitMs(int timeLimitMs) { this.timeLimitMs = timeLimitMs; }

    public int getMaxActionNodes() { return maxActionNodes; }
    public void setMaxActionNodes(int maxActionNodes) { this.maxActionNodes = maxActionNodes; }

    public int getMaxConditionNodes() { return maxConditionNodes; }
    public void setMaxConditionNodes(int maxConditionNodes) { this.maxConditionNodes = maxConditionNodes; }

    public int getMaxCustomVariables() { return maxCustomVariables; }
    public void setMaxCustomVariables(int maxCustomVariables) { this.maxCustomVariables = maxCustomVariables; }

    public int getPlayerTeamSize() { return playerTeamSize; }
    public void setPlayerTeamSize(int playerTeamSize) { this.playerTeamSize = playerTeamSize; }

    public int getOpponentTeamSize() { return opponentTeamSize; }
    public void setOpponentTeamSize(int opponentTeamSize) { this.opponentTeamSize = opponentTeamSize; }

    public JsonNode getLogicConfiguration() { return logicConfiguration; }
    public void setLogicConfiguration(JsonNode logicConfiguration) { this.logicConfiguration = logicConfiguration; }

    public JsonNode getWinConditions() { return winConditions; }
    public void setWinConditions(JsonNode winConditions) { this.winConditions = winConditions; }

    public JsonNode getLoseConditions() { return loseConditions; }
    public void setLoseConditions(JsonNode loseConditions) { this.loseConditions = loseConditions; }

    public List<PuzzleBotResponseDTO> getBots() { return bots; }
    public void setBots(List<PuzzleBotResponseDTO> bots) { this.bots = bots; }
}
