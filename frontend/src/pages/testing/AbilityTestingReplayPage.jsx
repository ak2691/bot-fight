import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar";
import SimulationReplay from "../../replay/SimulationReplay";
import { buildAbilityTestingPlayback } from "../../gameArena/testing/AbilityTestingSimulation.js";
import { ABILITY_TEST_PRESETS, getAbilityTestingPreset } from "../../gameArena/testing/AbilityTestingPresets.js";

export default function AbilityTestingReplayPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const [request] = useState(() => ({
        presetId: location.state?.presetId ?? ABILITY_TEST_PRESETS[0]?.id,
        payload: location.state?.payload ?? null,
    }));
    const [playbackStartsAtMs] = useState(() => Date.now() + 700);

    useEffect(() => {
        if (!location.state) return;
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }, [location.pathname, location.search, location.state, navigate]);

    const preset = getAbilityTestingPreset(request.presetId);
    const playback = useMemo(() => ({
        ...buildAbilityTestingPlayback({
            preset,
            ...(request.payload ?? {}),
        }),
        playbackStartsAtMs,
    }), [playbackStartsAtMs, preset, request.payload]);

    return (
        <main className="min-h-screen bg-arena-deep text-ink-hi font-ui">
            <AppNavbar account currentPage="ability-testing" />
            <SimulationReplay
                playback={playback}
                onCancel={() => navigate("/ability-testing", { replace: true })}
                cancelLabel="BACK TO ABILITY LAB"
            />
        </main>
    );
}
