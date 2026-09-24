import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(sourceDir, "../../..");
export const mcpRoot = path.resolve(sourceDir, "..");
const browserSnapshotScript = path.join(sourceDir, "browser-snapshot.js");
const javaSnapshotClass = "com.example.botfight.simulation.gameconfig.AbilityParitySnapshot";

function parseJsonLine(output, label) {
    const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!lines[index].startsWith("{")) continue;
        try {
            return JSON.parse(lines[index]);
        } catch {
            // Maven and runtime warnings can precede the final JSON line.
        }
    }
    throw new Error(`${label} did not emit a JSON snapshot.`);
}

export function readBrowserSnapshot() {
    const output = execFileSync(process.execPath, [browserSnapshotScript], {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 24 * 1024 * 1024,
    });
    return parseJsonLine(output, "Browser ability runtime");
}

export function readBackendSnapshot() {
    const serverDir = path.join(projectRoot, "server");
    const args = [
        "-q",
        "-DskipTests",
        "compile",
        "org.codehaus.mojo:exec-maven-plugin:3.5.0:java",
        `-Dexec.mainClass=${javaSnapshotClass}`,
        "-Dexec.classpathScope=runtime",
    ];
    const output = process.platform === "win32"
        ? runWindowsMaven(serverDir, args)
        : runUnixMaven(serverDir, args);
    return parseJsonLine(output, "Backend ability runtime");
}

function runUnixMaven(serverDir, args) {
    return execFileSync("./mvnw", args, {
        cwd: serverDir,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 180_000,
    });
}

function runWindowsMaven(serverDir, args) {
    const wrapper = path.join(serverDir, "mvnw.cmd");
    return execFileSync(wrapper, args, {
        cwd: serverDir,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 180_000,
        shell: true,
    });
}
