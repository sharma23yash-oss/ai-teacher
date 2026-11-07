import { describe, expect, it } from "vitest";
import { z } from "zod";
import { providerSafeJsonSchema } from "../json-schema";

describe("providerSafeJsonSchema", () => {
  it("drops keywords Gemini rejects, keeps real bounds", () => {
    const schema = z.object({ n: z.number().int(), p: z.number().positive().max(20), s: z.string().min(1).max(9), list: z.array(z.number().int().min(1)).max(3) });
    const out = JSON.stringify(providerSafeJsonSchema(z.toJSONSchema(schema, { target: "draft-7" })));
    expect(out).not.toContain("exclusiveMinimum");
    expect(out).not.toContain("9007199254740991");
    expect(out).not.toContain("$schema");
    expect(out).not.toMatch(/minLength|maxLength|maxItems/);
    expect(out).toContain('"maximum":20');
    expect(out).toContain('"minimum":1');
  });
});
