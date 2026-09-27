package com.example.botfight.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "botfight.chat-moderation")
public class ChatModerationProperties {
    private Duration evidenceRetention = Duration.ofDays(7);
    private Duration resolvedReportRetention = Duration.ofDays(90);
    private int maxOpenReportsPerUser = 5;

    public Duration getEvidenceRetention() { return evidenceRetention; }
    public void setEvidenceRetention(Duration evidenceRetention) { this.evidenceRetention = evidenceRetention; }
    public Duration getResolvedReportRetention() { return resolvedReportRetention; }
    public void setResolvedReportRetention(Duration resolvedReportRetention) {
        this.resolvedReportRetention = resolvedReportRetention;
    }
    public int getMaxOpenReportsPerUser() { return maxOpenReportsPerUser; }
    public void setMaxOpenReportsPerUser(int maxOpenReportsPerUser) {
        this.maxOpenReportsPerUser = maxOpenReportsPerUser;
    }
}
