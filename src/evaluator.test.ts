import { describe, expect, it } from "vitest";

import { createViewLanguage } from "./builder";
import {
  collectDecryptRequests,
  evaluateExpression,
  getCategoryRowByPath,
  getDefaultExpansionState,
  getViewRow,
  listCategoryDocumentIds,
  pageCategoryRows,
  pageViewRows,
  updateExpansionState,
} from "./evaluator";

describe("viewRuntime", () => {
  const v = createViewLanguage<{
    employee: string;
    hours: number;
    rate: number;
    workDate: string;
    note?: string;
    _attachments?: Array<{ fileName?: string; size?: number }>;
  }>();

  const definition = {
    title: "Time records",
    defaultExpand: "collapsed" as const,
    filter: {
      mode: "expression" as const,
      expression: v.gt(v.toNumber(v.field("hours")), v.number(0)),
    },
    columns: [
      {
        name: "employee",
        title: "Employee",
        role: "category" as const,
        expression: v.field("employee"),
        sorting: "ascending" as const,
      },
      {
        name: "amount",
        title: "Amount",
        role: "display" as const,
        expression: v.let(
          {
            hours: v.toNumber(v.field("hours")),
            rate: v.toNumber(v.field("rate")),
          },
          ({ hours, rate }) => v.mul(v.coalesce(hours, v.number(0)), v.coalesce(rate, v.number(0))),
        ),
        sorting: "descending" as const,
      },
      {
        name: "displayLabel",
        title: "Label",
        role: "display" as const,
        expression: v.ifElse(
          v.exists(v.field("note")),
          v.concat(v.field("employee"), v.string(": "), v.field("note")),
          v.field("employee"),
        ),
      },
    ],
  };

  const documents = [
    {
      id: "doc-1",
      createdAt: "2026-04-01T09:00:00.000Z",
      decryptionKeyId: "default",
      data: {
        employee: "Ada",
        hours: 8,
        rate: 10,
        workDate: "2026-04-01",
        note: "Planning",
        _attachments: [
          { fileName: "timesheet.pdf", size: 12 },
          { fileName: "receipt.png", size: 34 },
        ],
      },
    },
    {
      id: "doc-2",
      createdAt: "2026-04-02T09:00:00.000Z",
      decryptionKeyId: null,
      data: { employee: "Ada", hours: 4, rate: 11, workDate: "2026-04-02" },
    },
    { id: "doc-3", data: { employee: "Bob", hours: 0, rate: 12, workDate: "2026-04-03" } },
  ];

  it("pages declarative rows with expansion state", () => {
    const collapsed = pageViewRows(definition, documents, "tenant/db");
    expect(collapsed.rows.map((row) => row.key)).toEqual(["Ada"]);
    expect(collapsed.rows[0]?.expanded).toBe(false);

    const expanded = pageViewRows(definition, documents, "tenant/db", {
      expansion: { mode: "collapsed", ids: ["Ada"] },
    });
    expect(expanded.rows.map((row) => row.key)).toEqual(["Ada", "doc-1", "doc-2"]);
    expect(expanded.rows[1]?.values.amount).toBe(80);
    expect(expanded.rows[2]?.values.displayLabel).toBe("Ada");
  });

  it("supports row lookups and category traversal", () => {
    const row = getViewRow(definition, documents, "tenant/db", "doc-1");
    const category = getCategoryRowByPath(definition, documents, "tenant/db", ["Ada"]);
    const ids = listCategoryDocumentIds(definition, documents, "tenant/db", "Ada");
    const categoryPage = pageCategoryRows(
      definition,
      documents,
      "tenant/db",
      "Ada",
      { mode: "collapsed", ids: ["Ada"] },
      { pageSize: 10 },
    );

    expect(row?.docId).toBe("doc-1");
    expect(row?.siblingCount).toBe(2);
    expect(category?.descendantDocumentCount).toBe(2);
    expect(category?.childDocumentCount).toBe(2);
    expect(category?.childCount).toBe(2);
    expect(category?.siblingCount).toBe(1);
    expect(ids).toEqual(["doc-1", "doc-2"]);
    expect(categoryPage.rows.map((entry) => entry.key)).toEqual(["doc-1", "doc-2"]);
  });

  it("updates expansion states consistently", () => {
    const defaultState = getDefaultExpansionState(definition);
    expect(defaultState).toEqual({ mode: "collapsed", ids: [] });

    const expanded = updateExpansionState(defaultState, "Ada", "expand");
    const collapsed = updateExpansionState(expanded, "Ada", "collapse");

    expect(expanded).toEqual({ mode: "collapsed", ids: ["Ada"] });
    expect(collapsed).toEqual({ mode: "collapsed", ids: [] });
  });

  it("evaluates left and right string helpers with delimiters and counts", () => {
    expect(evaluateExpression(v.left("xyz_d", "_d"), {
      doc: {},
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBe("xyz");
    expect(evaluateExpression(v.left("xyz_d_aaxd", "d"), {
      doc: {},
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBe("xyz_");
    expect(evaluateExpression(v.left("xyz_d", 2), {
      doc: {},
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBe("xy");
    expect(evaluateExpression(v.right("xyz_d", "_"), {
      doc: {},
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBe("d");
    expect(evaluateExpression(v.right("xyz_d", 2), {
      doc: {},
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBe("_d");
  });

  it("evaluates document metadata and attachment helpers", () => {
    expect(evaluateExpression(v.createdAt(), {
      doc: documents[0]!.data,
      values: {},
      origin: "tenant/db",
      createdAt: documents[0]!.createdAt,
      variables: {},
    })).toBe("2026-04-01T09:00:00.000Z");
    expect(evaluateExpression(v.decryptionKeyId(), {
      doc: documents[0]!.data,
      values: {},
      origin: "tenant/db",
      decryptionKeyId: documents[0]!.decryptionKeyId,
      variables: {},
    })).toBe("default");
    expect(evaluateExpression(v.attachmentNames(), {
      doc: documents[0]!.data,
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toEqual(["timesheet.pdf", "receipt.png"]);
    expect(evaluateExpression(v.attachmentLengths(), {
      doc: documents[0]!.data,
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toEqual([12, 34]);
    expect(evaluateExpression(v.attachmentCount(), {
      doc: documents[0]!.data,
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBe(2);
    expect(evaluateExpression(v.decryptionKeyId(), {
      doc: documents[1]!.data,
      values: {},
      origin: "tenant/db",
      decryptionKeyId: documents[1]!.decryptionKeyId,
      variables: {},
    })).toBeNull();
    expect(evaluateExpression(v.createdAt(), {
      doc: documents[2]!.data,
      values: {},
      origin: "tenant/db",
      variables: {},
    })).toBeNull();
  });

  it("evaluates view row count helpers from the row count context", () => {
    const context = {
      doc: {},
      values: {},
      origin: "tenant/db",
      counts: {
        childCount: 3,
        childCategoryCount: 1,
        childDocumentCount: 2,
        descendantCount: 8,
        descendantCategoryCount: 2,
        descendantDocumentCount: 6,
      },
      variables: {},
    };

    expect(evaluateExpression(v.childCount(), context)).toBe(3);
    expect(evaluateExpression(v.childCategoryCount(), context)).toBe(1);
    expect(evaluateExpression(v.childDocumentCount(), context)).toBe(2);
    expect(evaluateExpression(v.descendantCount(), context)).toBe(8);
    expect(evaluateExpression(v.descendantCategoryCount(), context)).toBe(2);
    expect(evaluateExpression(v.descendantDocumentCount(), context)).toBe(6);
  });

  it("threads document metadata through paged view evaluation", () => {
    const runtimeDefinition = {
      title: "Attachments",
      columns: [
        {
          name: "createdAt",
          role: "display" as const,
          expression: v.createdAt(),
        },
        {
          name: "keyId",
          role: "display" as const,
          expression: v.decryptionKeyId(),
        },
        {
          name: "attachmentCount",
          role: "display" as const,
          expression: v.attachmentCount(),
        },
      ],
    };

    const page = pageViewRows(runtimeDefinition, documents, "tenant/db", { pageSize: 10 });

    expect(page.rows.map((row) => [row.key, row.values])).toEqual([
      ["doc-3", { createdAt: null, keyId: null, attachmentCount: 0 }],
      ["doc-1", { createdAt: "2026-04-01T09:00:00.000Z", keyId: "default", attachmentCount: 2 }],
      ["doc-2", { createdAt: "2026-04-02T09:00:00.000Z", keyId: null, attachmentCount: 0 }],
    ]);
  });

  it("evaluates isWitnessed/isAwaitingWitness for the three document states", () => {
    const base = { doc: {}, values: {}, origin: "tenant/db", variables: {} };

    // Legacy (no store entryVersion): both false. Defaults stand in for a host
    // that supplies neither flag.
    expect(evaluateExpression(v.isWitnessed(), base)).toBe(false);
    expect(evaluateExpression(v.isAwaitingWitness(), base)).toBe(false);

    // New, versioned, not yet synced: awaiting witness, not witnessed.
    const unsynced = { ...base, witnessed: false, awaitingWitness: true };
    expect(evaluateExpression(v.isWitnessed(), unsynced)).toBe(false);
    expect(evaluateExpression(v.isAwaitingWitness(), unsynced)).toBe(true);

    // Synced/witnessed: witnessed, no longer awaiting.
    const synced = { ...base, witnessed: true, awaitingWitness: false };
    expect(evaluateExpression(v.isWitnessed(), synced)).toBe(true);
    expect(evaluateExpression(v.isAwaitingWitness(), synced)).toBe(false);
  });

  it("filters and projects witness state through paged view evaluation", () => {
    const witnessDefinition = {
      title: "Pending sync",
      filter: {
        mode: "expression" as const,
        // Only documents still waiting to be witnessed (locally created/edited).
        expression: v.isAwaitingWitness(),
      },
      columns: [
        { name: "witnessed", role: "display" as const, expression: v.isWitnessed() },
        { name: "awaiting", role: "display" as const, expression: v.isAwaitingWitness() },
      ],
    };

    const witnessDocuments = [
      // Legacy: excluded by the filter, both flags false.
      { id: "legacy", data: { name: "old" } },
      // Versioned + unsynced: included, awaiting witness.
      { id: "local", data: { name: "draft" }, witnessed: false, awaitingWitness: true },
      // Witnessed: excluded by the filter.
      { id: "synced", data: { name: "live" }, witnessed: true, awaitingWitness: false },
    ];

    const page = pageViewRows(witnessDefinition, witnessDocuments, "tenant/db", { pageSize: 10 });

    expect(page.rows.map((row) => [row.key, row.values])).toEqual([
      ["local", { witnessed: false, awaiting: true }],
    ]);
  });
});

describe("decrypt and json evaluation", () => {
  const v = createViewLanguage<{
    user_details_encrypted: string;
    user_details_encrypted_key?: string;
    profile: string | Record<string, unknown>;
  }>();

  const userDetails = { username: "Ada", address: { city: "London" } };
  const base = {
    doc: { profile: JSON.stringify(userDetails) },
    values: {},
    origin: "tenant/db",
    variables: {},
    decrypted: { user_details_encrypted: JSON.stringify(userDetails) },
  };

  it("returns the raw plaintext for decryptField", () => {
    expect(evaluateExpression(v.decryptField("user_details_encrypted"), base)).toBe(
      JSON.stringify(userDetails),
    );
  });

  it("parses and extracts paths for decryptJson", () => {
    expect(evaluateExpression(v.decryptJson("user_details_encrypted"), base)).toEqual(userDetails);
    expect(evaluateExpression(v.decryptJson("user_details_encrypted", "username"), base)).toBe("Ada");
    expect(evaluateExpression(v.decryptJson("user_details_encrypted", "address.city"), base)).toBe("London");
  });

  it("returns null when no plaintext was pre-resolved", () => {
    const noDecrypt = { ...base, decrypted: undefined };
    expect(evaluateExpression(v.decryptField("user_details_encrypted"), noDecrypt)).toBeNull();
    expect(evaluateExpression(v.decryptJson("user_details_encrypted", "username"), noDecrypt)).toBeNull();
  });

  it("parses JSON strings and passes objects through for json", () => {
    expect(evaluateExpression(v.json("profile", "address.city"), base)).toBe("London");
    const objectDoc = { ...base, doc: { profile: userDetails } };
    expect(evaluateExpression(v.json("profile"), objectDoc)).toEqual(userDetails);
    expect(evaluateExpression(v.json("profile", "username"), objectDoc)).toBe("Ada");
  });

  it("returns null for invalid JSON in json/decryptJson", () => {
    const invalid = {
      ...base,
      doc: { profile: "{not json" },
      decrypted: { user_details_encrypted: "{not json" },
    };
    expect(evaluateExpression(v.json("profile"), invalid)).toBeNull();
    expect(evaluateExpression(v.decryptJson("user_details_encrypted"), invalid)).toBeNull();
  });

  it("collects decrypt requests but ignores json nodes", () => {
    const expression = v.concat(
      v.decryptJson("user_details_encrypted", "username"),
      v.json("profile", "username"),
      v.decryptField("user_details_encrypted", v.field("user_details_encrypted_key")),
    );

    const requests = collectDecryptRequests(expression);
    expect(requests).toEqual([
      { field: "user_details_encrypted", key: undefined },
      { field: "user_details_encrypted", key: { kind: "field", path: "user_details_encrypted_key" } },
    ]);
  });
});
