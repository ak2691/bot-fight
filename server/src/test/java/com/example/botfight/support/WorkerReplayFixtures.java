package com.example.botfight.support;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.match.model.MatchSession;
import com.example.botfight.service.simulation.WorkerReplay;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.json.JsonMapper;

public final class WorkerReplayFixtures {
    private WorkerReplayFixtures() {}
    public static MatchReplayDTO replay(String outcome, UUID winner, Integer winnerTeam, String endReason,
            List<WorkerReplay.EndBotState> endState, List<Integer> elapsedTimes) {
        var mapper = new JsonMapper();
        int duration = elapsedTimes.isEmpty() ? 0 : elapsedTimes.getLast();
        var batches = new ArrayList<WorkerReplay.Batch>();
        for (int start = 0; start < duration; start += 1000) {
            int from = start, to = Math.min(duration, start + 1000);
            var frames = mapper.createArrayNode();
            elapsedTimes.stream().filter(t -> (t > from || from == 0 && t == 0) && t <= to)
                    .forEach(t -> frames.addObject().put("elapsedMs", t).putArray("shapes"));
            if (!frames.isEmpty()) batches.add(new WorkerReplay.Batch(batches.size()+1, to,
                    to == duration, mapper.writeValueAsString(frames)));
        }
        var hp = endState.stream().map(WorkerReplay.EndBotState::teamNumber).distinct()
                .map(team -> new WorkerReplay.TeamHp(team, endState.stream().filter(b -> b.teamNumber() == team)
                        .mapToDouble(WorkerReplay.EndBotState::hp).sum())).toList();
        var raw = new WorkerReplay(new WorkerReplay.Result("test-engine", outcome, endReason, winnerTeam,
                hp, duration, endState, null), "{\"width\":1200,\"height\":1200,\"shapes\":[]}", batches);
        return new MatchReplayDTO(outcome, winner, "worker result", null, duration, true, null).withWorkerReplay(raw);
    }
    public static MatchReplayDTO replay(MatchSession session, String outcome, UUID winner, List<Integer> times) {
        Integer team = winner == null ? null : session.players().stream().filter(p -> p.userId().equals(winner))
                .map(p -> p.teamNumber()).findFirst().orElseThrow();
        var end = session.players().stream().map(p -> new WorkerReplay.EndBotState(p.slot(),100,100,0.0,
                team != null && p.teamNumber()!=team ? 0 : 150, p.teamNumber(),100,false,null)).toList();
        return replay(outcome, winner, team, team == null ? "SEGMENT_END" : "KO", end, times);
    }
    public static List<Integer> elapsed(MatchReplayDTO replay) {
        var frames = new JsonMapper().readTree(replay.workerReplay() == null ? "[]" : replay.workerReplay().frames());
        var times = new ArrayList<Integer>();
        frames.forEach(f -> times.add(f.path("elapsedMs").asInt()));
        return times;
    }
}
