package com.example.botfight.service.system;

import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Service;

/**
 * Fail-closed readiness state used while startup reconciliation is running.
 */
@Service
public class StartupReadinessService {

    private final AtomicBoolean ready = new AtomicBoolean(false);

    public boolean isReady() {
        return ready.get();
    }

    public void markReady() {
        ready.set(true);
    }
}
