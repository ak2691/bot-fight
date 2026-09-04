package com.example.botfight.domain.puzzle;

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
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "puzzle_bots", uniqueConstraints = {
        @UniqueConstraint(name = "puzzle_bots_puzzle_team_slot_unique", columnNames = {"puzzle_id", "team_number", "slot"})
})
public class PuzzleBot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "puzzle_id", nullable = false)
    private Puzzle puzzle;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private PuzzleBotRole role;

    @Column(name = "team_number", nullable = false)
    private int teamNumber = 1;

    @Column(nullable = false)
    private int slot = 1;

    @Column(nullable = false, length = 40)
    private String loadout;

    @Column(name = "start_x", nullable = false)
    private double startX;

    @Column(name = "start_y", nullable = false)
    private double startY;

    @Column(nullable = false)
    private double rotation;

    @Column(name = "start_hp", nullable = false)
    private double startHp = 150;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "brain_payload", nullable = false)
    private String brainPayload = "{}";

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public Puzzle getPuzzle() { return puzzle; }
    public void setPuzzle(Puzzle puzzle) { this.puzzle = puzzle; }

    public PuzzleBotRole getRole() { return role; }
    public void setRole(PuzzleBotRole role) { this.role = role; }

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

    public String getBrainPayload() { return brainPayload; }
    public void setBrainPayload(String brainPayload) { this.brainPayload = brainPayload; }
}
