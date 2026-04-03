import { describe, expect, it } from "vitest";

import { createViewLanguage } from "./builder";

describe("createViewLanguage", () => {
  it("builds declarative expressions with lets and branching", () => {
    const v = createViewLanguage<{
      hours: number;
      rate: number;
      status: string;
      employee: { firstName: string; lastName: string };
    }>();

    const expression = v.let(
      {
        hours: v.toNumber(v.field("hours")),
        rate: v.toNumber(v.field("rate")),
      },
      ({ hours, rate }) => v.ifElse(
        v.eq(v.field("status"), "approved"),
        v.mul(v.coalesce(hours, 0), v.coalesce(rate, 0)),
        0,
      ),
    );

    expect(expression).toEqual({
      kind: "let",
      bindings: {
        hours: { kind: "operation", op: "number", args: [{ kind: "field", path: "hours" }] },
        rate: { kind: "operation", op: "number", args: [{ kind: "field", path: "rate" }] },
      },
      result: {
        kind: "if",
        condition: {
          kind: "operation",
          op: "eq",
          args: [
            { kind: "field", path: "status" },
            { kind: "literal", value: "approved" },
          ],
        },
        whenTrue: {
          kind: "operation",
          op: "mul",
          args: [
            {
              kind: "operation",
              op: "coalesce",
              args: [
                { kind: "variable", name: "hours" },
                { kind: "literal", value: 0 },
              ],
            },
            {
              kind: "operation",
              op: "coalesce",
              args: [
                { kind: "variable", name: "rate" },
                { kind: "literal", value: 0 },
              ],
            },
          ],
        },
        whenFalse: { kind: "literal", value: 0 },
      },
    });
  });

  it("accepts literal shorthand for helper arguments, branches, and let bindings", () => {
    const v = createViewLanguage<{
      status: string;
      note?: string;
    }>();

    const expression = v.let(
      {
        defaults: { tags: ["review"], active: true },
        fallback: null,
      },
      ({ defaults, fallback }) => v.ifElse(
        v.and(
          v.eq(v.field("status"), "approved"),
          true,
        ),
        v.concat(v.field("note"), " / ", defaults),
        fallback,
      ),
    );

    expect(expression).toEqual({
      kind: "let",
      bindings: {
        defaults: { kind: "literal", value: { tags: ["review"], active: true } },
        fallback: { kind: "literal", value: null },
      },
      result: {
        kind: "if",
        condition: {
          kind: "operation",
          op: "and",
          args: [
            {
              kind: "operation",
              op: "eq",
              args: [
                { kind: "field", path: "status" },
                { kind: "literal", value: "approved" },
              ],
            },
            { kind: "literal", value: true },
          ],
        },
        whenTrue: {
          kind: "operation",
          op: "concat",
          args: [
            { kind: "field", path: "note" },
            { kind: "literal", value: " / " },
            { kind: "variable", name: "defaults" },
          ],
        },
        whenFalse: { kind: "variable", name: "fallback" },
      },
    });
  });

  it("builds left and right string helper expressions", () => {
    const v = createViewLanguage<{ code: string }>();

    expect(v.left(v.field("code"), "_d")).toEqual({
      kind: "operation",
      op: "left",
      args: [
        { kind: "field", path: "code" },
        { kind: "literal", value: "_d" },
      ],
    });

    expect(v.right(v.field("code"), 2)).toEqual({
      kind: "operation",
      op: "right",
      args: [
        { kind: "field", path: "code" },
        { kind: "literal", value: 2 },
      ],
    });
  });
});
