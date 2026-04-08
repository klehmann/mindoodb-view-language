import { describe, expect, it } from "vitest";

import { createViewLanguage } from "./builder";
import {
  getMindooDBViewLanguageHelper,
  mindooDBViewLanguageHelpers,
  mindooDBViewLanguageHelpersByName,
} from "./metadata";

describe("view language metadata", () => {
  it("covers every builder helper exactly once", () => {
    const helperNames = Object.keys(createViewLanguage<Record<string, unknown>, Record<string, unknown>>()).sort();
    const metadataNames = mindooDBViewLanguageHelpers.map((entry) => entry.name).sort();

    expect(metadataNames).toEqual(helperNames);
  });

  it("provides structured lookup metadata for editor integrations", () => {
    expect(mindooDBViewLanguageHelpersByName.field.signature).toBe("field(path)");
    expect(mindooDBViewLanguageHelpersByName.field.arguments[0]).toMatchObject({
      name: "path",
      kind: "field-path",
    });

    expect(getMindooDBViewLanguageHelper("let")).toMatchObject({
      category: "control-flow",
      returnType: "Expression<T>",
    });
    expect(getMindooDBViewLanguageHelper("left")).toMatchObject({
      category: "string",
      signature: "left(value, by)",
    });
    expect(getMindooDBViewLanguageHelper("decryptionKeyId")).toMatchObject({
      category: "context",
      signature: "decryptionKeyId()",
      returnType: "Expression<string | null>",
    });
    expect(getMindooDBViewLanguageHelper("attachmentCount")).toMatchObject({
      category: "context",
      signature: "attachmentCount()",
      returnType: "Expression<number>",
    });
  });
});
