const { buildInstructions } = require("../agent/buildInstructions");

function buildSessionBody({ instructions }) {
  return {
    model: "gpt-realtime",
    voice: "ash",
    instructions,
    turn_detection: { type: "server_vad", threshold: 0.40, silence_duration_ms: 220, prefix_padding_ms: 160, interrupt_response: true },
    tool_choice: "auto",
    tools: [
      {
        type: "function",
        name: "question_bank_get",
        description: "Fetch a question from the English pool. The agent translates to the session language.",
        parameters: {
          type: "object",
          properties: { qtype: { type: "string", enum: ["personal-fit", "behavioral"] } },
          required: ["qtype"]
        }
      }
    ]
  };
}

describe("session body includes tool & tool_choice", () => {
  test("build body", async () => {
    const instructions = await buildInstructions({ mode: "behavioral", language: "de" });
    const body = buildSessionBody({ instructions });
    expect(body.model).toBe("gpt-realtime");
    expect(body.tool_choice).toBe("auto");
    const tool = body.tools.find(t => t.name === "question_bank_get");
    expect(tool).toBeTruthy();
    expect(tool.parameters.properties.qtype.enum).toEqual(["personal-fit", "behavioral"]);
  });
});
