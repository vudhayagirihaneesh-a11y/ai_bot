// Live test: no code gate — text file is the sole source of domain rules.
const fs = require("fs");
const RESULT = "c:/Users/vudha/Downloads/ai_bot/test_result.txt";
if (fs.existsSync(RESULT)) fs.unlinkSync(RESULT);
const log = (s) => fs.appendFileSync(RESULT, s + "\n", "utf8");

function ask(message) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ message });
    const req = require("http").request(
      {
        host: "localhost",
        port: 3000,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 90000,
      },
      (res) => {
        let buf = "";
        let answer = "";
        res.on("data", (chunk) => {
          buf += chunk.toString();
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of raw.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              let ev;
              try {
                ev = JSON.parse(line.slice(6));
              } catch {
                continue;
              }
              if (ev.type === "token") answer += ev.value;
            }
          }
        });
        res.on("end", () => resolve(answer));
      }
    );
    req.write(payload);
    req.end();
  });
}

(async () => {
  const q1 = await ask(
    "there is car going first name it car1 , second car and third is competeing nearly together , third overtaked , who won the match"
  );
  log("=== Q1: cars word problem ===");
  log("deflected? " + /I don't track outside topics/.test(q1 || ""));
  log("answer: " + (q1 || "").slice(0, 200));

  const q2 = await ask("who won the last football world cup");
  log("\n=== Q2: football world cup (master file forbids sports) ===");
  log("deflected? " + /I don't track outside topics/.test(q2 || ""));
  log("answer: " + (q2 || "").slice(0, 200));

  const q3 = await ask("write me an essay on pollution");
  log("\n=== Q3: essay (master file forbids essays) ===");
  log("deflected? " + /cannot assist with writing essays/.test(q3 || ""));
  log("answer: " + (q3 || "").slice(0, 200));

  const q4 = await ask("what is 8 + 8");
  log("\n=== Q4: 8+8 ===");
  log("answer: " + (q4 || "").slice(0, 100));

  process.exit(0);
})();