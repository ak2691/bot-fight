package com.example.botfight.support;

import com.example.botfight.service.party.PartyService;
import java.util.List;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

/** Fully supplied collaborators for tests outside the party lifecycle. */
public final class TestDependencies {
    private TestDependencies() {}

    public static PartyService partyService() {
        PartyService service = mock(PartyService.class);
        when(service.removeDisconnected(any(), any()))
                .thenReturn(new PartyService.LeaveResult(null, null, List.of()));
        return service;
    }
}
