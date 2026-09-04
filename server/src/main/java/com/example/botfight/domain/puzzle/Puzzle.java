package com.example.botfight.domain.puzzle;

import com.example.botfight.domain.auth.AppUser;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "puzzles")
public class Puzzle {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "puzzle_number", nullable = false, unique = true)
    private Long puzzleNumber;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 2000)
    private String description = "";

    @Column(name = "initial_elapsed_ms", nullable = false)
    private int initialElapsedMs;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private PuzzleStatus status = PuzzleStatus.DRAFT;

    @Column(name = "hide_opponent_code", nullable = false)
    private boolean hideOpponentCode = true;

    @Column(name = "time_limit_ms", nullable = false)
    private int timeLimitMs = 90_000;

    @Column(name = "max_action_nodes", nullable = false)
    private int maxActionNodes = 100;

    @Column(name = "max_condition_nodes", nullable = false)
    private int maxConditionNodes = 300;

    @Column(name = "max_custom_variables", nullable = false)
    private int maxCustomVariables = 100;

    @Column(name = "player_team_size", nullable = false)
    private int playerTeamSize = 1;

    @Column(name = "opponent_team_size", nullable = false)
    private int opponentTeamSize = 1;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "win_conditions", nullable = false)
    private String winConditions = "[]";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "lose_conditions", nullable = false)
    private String loseConditions = "[]";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "logic_configuration", nullable = false)
    private String logicConfiguration = "{}";

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false)
    private AppUser createdBy;

    @OneToMany(mappedBy = "puzzle", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<PuzzleBot> bots = new ArrayList<>();

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false)
    private Instant updatedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public Long getPuzzleNumber() { return puzzleNumber; }
    public void setPuzzleNumber(Long puzzleNumber) { this.puzzleNumber = puzzleNumber; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public int getInitialElapsedMs() { return initialElapsedMs; }
    public void setInitialElapsedMs(int initialElapsedMs) { this.initialElapsedMs = initialElapsedMs; }

    public PuzzleStatus getStatus() { return status; }
    public void setStatus(PuzzleStatus status) { this.status = status; }

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

    public String getWinConditions() { return winConditions; }
    public void setWinConditions(String winConditions) { this.winConditions = winConditions; }

    public String getLoseConditions() { return loseConditions; }
    public void setLoseConditions(String loseConditions) { this.loseConditions = loseConditions; }

    public String getLogicConfiguration() { return logicConfiguration; }
    public void setLogicConfiguration(String logicConfiguration) { this.logicConfiguration = logicConfiguration; }

    public AppUser getCreatedBy() { return createdBy; }
    public void setCreatedBy(AppUser createdBy) { this.createdBy = createdBy; }

    public List<PuzzleBot> getBots() { return bots; }
    public void setBots(List<PuzzleBot> bots) { this.bots = bots; }

    public void replaceBots(List<PuzzleBot> nextBots) {
        bots.clear();
        if (nextBots != null) {
            nextBots.forEach(this::addBot);
        }
    }

    public void addBot(PuzzleBot bot) {
        if (bot == null) return;
        bot.setPuzzle(this);
        bots.add(bot);
    }

    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
