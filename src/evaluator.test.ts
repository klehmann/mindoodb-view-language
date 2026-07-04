import { describe, expect, it } from "vitest";

import { createViewLanguage } from "./builder";
import {
  getCategoryRowByPath,
  getDefaultExpansionState,
  getViewRow,
  listCategoryDocumentIds,
  pageCategoryRows,
  pageViewRows,
  updateExpansionState,
} from "./evaluator";

// Expression-evaluation tests moved to mindoodb core
// (mindoodb/src/__tests__/ExpressionEvaluator.test.ts). Only the in-memory
// view-tree builder is still owned by this package.
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
