package com.example.botfight.DTO;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ArenaPayloadDTO {
    private CoordinateDTO playerModel;
    private Integer reward;
    private List<ShapeObjectDTO> objects;
}