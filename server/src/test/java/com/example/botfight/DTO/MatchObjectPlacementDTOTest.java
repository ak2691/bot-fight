package com.example.botfight.DTO;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MatchObjectPlacementDTOTest {

    private final JsonMapper jsonMapper = new JsonMapper();

    @Test
    void deserializesBrowserPlacementPayloadWithoutPlaybackFields() throws Exception {
        MatchObjectPlacementDTO payload = jsonMapper.readValue(
                "{\"objects\":[{\"id\":\"p1_object_1\",\"type\":\"healthPack\",\"x\":300,\"y\":120,\"size\":42,\"rotation\":0}]}",
                MatchObjectPlacementDTO.class);

        assertThat(payload.objects()).singleElement().satisfies(object -> {
            assertThat(object.id()).isEqualTo("p1_object_1");
            assertThat(object.type()).isEqualTo("healthPack");
            assertThat(object.x()).isEqualTo(300.0);
            assertThat(object.y()).isEqualTo(120.0);
            assertThat(object.size()).isEqualTo(42);
            assertThat(object.rotation()).isEqualTo(0.0);
        });
    }
}
