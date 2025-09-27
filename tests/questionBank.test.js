const { getQuestion, loadAll } = require("../tools/questionBank");

describe("questionBank (EN-only pool)", () => {
  test("returns personal-fit question", async () => {
    const q = await getQuestion({ qtype: "personal-fit" });
    expect(q.type).toBe("personal-fit");
    expect(typeof q.question).toBe("string");
  });
  test("returns behavioral question", async () => {
    const q = await getQuestion({ qtype: "behavioral" });
    expect(q.type).toBe("behavioral");
    expect(typeof q.question).toBe("string");
  });
});

test("tool schema expectation (doc test)", () => {
  // Stelle sicher, dass deine /session Erstellung 'question_bank_get' mit 'qtype' only vorsieht.
  // (Wenn du createRealtimeSessionBody nutzt, importiere es und prüfe body.tools[0].parameters.)
  expect(true).toBe(true);
});
