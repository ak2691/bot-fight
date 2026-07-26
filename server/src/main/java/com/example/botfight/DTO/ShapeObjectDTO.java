package com.example.botfight.DTO;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ShapeObjectDTO {
    private String id;
    private String type;
    private int x;
    private int y;
    private int size;
    private int rotation;
}