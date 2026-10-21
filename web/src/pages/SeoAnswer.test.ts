import { describe, expect, it } from "vitest";
import { aiName, intentOf } from "./SeoAnswer";

describe("AEO / GEO classifiers", () => {
  it("spots question, cost, comparison and worry searches", () => {
    expect(intentOf("how long does a root canal take")).toBe("Question");
    expect(intentOf("dental implant cost bangalore")).toBe("Cost");
    expect(intentOf("best dentist near me")).toBe("Best / compare");
    expect(intentOf("is teeth whitening safe")).toBe("Question");
    expect(intentOf("root canal pain after")).toBe("Concern");
    expect(intentOf("elites dental care")).toBeNull();
  });
  it("names AI assistants from GA4 sources", () => {
    expect(aiName("chatgpt.com")).toBe("ChatGPT");
    expect(aiName("perplexity.ai")).toBe("Perplexity");
    expect(aiName("gemini.google.com")).toBe("Gemini");
    expect(aiName("copilot.microsoft.com")).toBe("Microsoft Copilot");
    expect(aiName("google")).toBeNull();
  });
});
