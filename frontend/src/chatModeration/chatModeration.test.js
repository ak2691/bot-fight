import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const matchChat = read("../matchmaking/MatchChat.jsx");
const lobbyChat = read("../pages/customLobby/CustomLobbyChat.jsx");
const reportAction = read("./ChatReportButton.jsx");
const api = read("./chatModerationApi.js");
const adminPage = read("../pages/admin/ChatReportsPage.jsx");
const app = read("../App.jsx");

test("match and custom-lobby chat expose report actions only for other users' server message IDs", () => {
    assert.match(matchChat, /message\.username !== currentUsername && <ChatReportButton messageId=\{message\.messageId\}/);
    assert.match(lobbyChat, /message\.username !== currentUsername && <ChatReportButton messageId=\{message\.messageId\}/);
    assert.match(reportAction, /isServerMessageId\(messageId\)/);
    assert.match(reportAction, /maxLength=\{300\}/);
    assert.match(reportAction, /Thanks for letting us know\./);
});

test("report API sends only a category and bounded optional note with session and CSRF", () => {
    assert.match(api, /ensureCsrfHeaders\("POST"\)/);
    assert.match(api, /credentials: "include"/);
    assert.match(api, /JSON\.stringify\(\{ reason, note \}\)/);
    assert.doesNotMatch(api, /senderUserId|contextId|evidenceText/);
});

test("chat reports use a protected admin route with review, resolve, audit, and deletion actions", () => {
    assert.match(app, /path="\/admin\/chat-reports"/);
    assert.match(app, /<AdminRoute>[\s\S]*<ChatReportsPage \/>[\s\S]*<\/AdminRoute>/);
    assert.match(adminPage, /fetchChatReportAudit/);
    assert.match(adminPage, /resolveChatReport\(detail\.reportId/);
    assert.match(adminPage, /deleteChatReport\(detail\.reportId\)/);
    assert.match(adminPage, /\{detail\.message\}/);
    assert.doesNotMatch(adminPage, /dangerouslySetInnerHTML/);
});
