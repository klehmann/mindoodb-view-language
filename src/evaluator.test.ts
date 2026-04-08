import { describe, expect, it } from "vitest";

import { createViewLanguage } from "./builder";
import {
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
    { id: "doc-2", decryptionKeyId: null, data: { employee: "Ada", hours: 4, rate: 11, workDate: "2026-04-02" } },
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
    expect(category?.descendantDocumentCount).toBe(2);
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
  });

  it("threads decryption key metadata through paged view evaluation", () => {
    const runtimeDefinition = {
      title: "Attachments",
      columns: [
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
      ["doc-2", { keyId: null, attachmentCount: 0 }],
      ["doc-3", { keyId: null, attachmentCount: 0 }],
      ["doc-1", { keyId: "default", attachmentCount: 2 }],
    ]);
  });
});
