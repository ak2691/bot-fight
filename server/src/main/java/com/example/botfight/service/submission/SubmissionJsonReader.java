package com.example.botfight.service.submission;

import com.example.botfight.DTO.submission.BotSubmissionPayloadDTO;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * Parses a submission body with a low nesting limit. A real brain nests a few dozen levels at most
 * (see {@link BotSubmissionValidationService#MAX_TREE_DEPTH}); a deeper document is hostile and is rejected
 * by the parser before any node tree for it exists. The request size limit is enforced earlier, by
 * {@code RequestPayloadLimitFilter}.
 */
@Component
public class SubmissionJsonReader {

    /** Two levels per branch of nesting, plus the payload, brain, conditions and operand levels around them. */
    public static final int MAX_NESTING_DEPTH = BotSubmissionValidationService.MAX_TREE_DEPTH * 2 + 40;

    private final JsonMapper mapper;

    public SubmissionJsonReader() {
        JsonFactory factory = JsonFactory.builder()
                .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(MAX_NESTING_DEPTH).build())
                .build();
        // Unknown properties are ignored by the DTO binding, as in the application mapper; the brain itself is
        // checked by the schema, which rejects unknown fields.
        this.mapper = JsonMapper.builder(factory).disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
    }

    public BotSubmissionPayloadDTO read(String body) {
        try {
            return mapper.readValue(body, BotSubmissionPayloadDTO.class);
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Submission is not valid JSON");
        }
    }
}
