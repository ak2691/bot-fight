package com.example.botfight.DTO;

import java.util.List;

/** Client-owned placement fields; playback-only state is added by the server. */
public record MatchObjectPlacementDTO(List<ObjectPlacementDTO> objects) {
    public record ObjectPlacementDTO(
            String id,
            String type,
            double x,
            double y,
            int size,
            double rotation) {
    }
}
