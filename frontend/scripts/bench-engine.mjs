import { runBenchmark } from "../src/gameArena/testing/engineBenchmark.js";

const passes = runBenchmark();
const ids = passes[0].results.map((result) => result.id).sort();
const width = Math.max(...ids.map((id) => id.length), 8);
const msOf = (pass, id) => pass.results.find((result) => result.id === id).ms;
const row = (cells) => cells.map((cell, index) => (index === 0 ? cell.padEnd(width) : cell.padStart(10))).join(" ");

console.log(row(["scenario", ...passes.map((pass) => `pass ${pass.pass} ms`)]));
for (const id of ids) {
    console.log(row([id, ...passes.map((pass) => msOf(pass, id).toFixed(0))]));
}
console.log(row(["TOTAL", ...passes.map((pass) => pass.results.reduce((sum, result) => sum + result.ms, 0).toFixed(0))]));
