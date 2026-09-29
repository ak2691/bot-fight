export function initialPresentationViewState(shape, now) {
    const position = { x: Number(shape.x), y: Number(shape.y) };
    return {
        shape,
        authoritativeShape: shape,
        motion: {
            from: position,
            to: { ...position },
            startedAt: now,
            durationMs: 0,
        },
    };
}

function destroyDisplay(display) {
    if (!display) return;
    display.parent?.removeChild?.(display);
    display.destroy?.({ children: true });
}

function clearDisplayMap(displayMap) {
    if (!displayMap) return;
    for (const entry of displayMap.values()) destroyDisplay(entry.container);
    displayMap.clear();
}

export function clearPresentationArtifacts({ views, visualViews, lockOnMarkers, particles } = {}) {
    clearDisplayMap(views);
    clearDisplayMap(visualViews);
    clearDisplayMap(lockOnMarkers);
    if (!particles) return;
    particles.forEach((particle) => destroyDisplay(particle.display));
    particles.length = 0;
}
