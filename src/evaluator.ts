import type {
  MindooDBAppBooleanExpression,
  MindooDBAppExpression,
  MindooDBAppViewDefinition,
  MindooDBAppViewExpansionState,
  MindooDBAppViewPageRequest,
  MindooDBAppViewPageResult,
  MindooDBAppViewRow,
} from "./types";

type InternalRow = MindooDBAppViewRow & {
  childKeys: string[];
};

type ViewTree = {
  rowsByKey: Map<string, InternalRow>;
  rootKeys: string[];
  categoryKeys: string[];
};

type EvaluationContext = {
  doc: Record<string, unknown>;
  values: Record<string, unknown>;
  origin: string;
  decryptionKeyId?: string | null;
  variables: Record<string, unknown>;
};

type AttachmentLike = {
  fileName?: unknown;
  size?: unknown;
};

/** Creates the initial category expansion mode for a view definition. */
export function getDefaultExpansionState(definition: MindooDBAppViewDefinition): MindooDBAppViewExpansionState {
  return definition.defaultExpand === "collapsed"
    ? { mode: "collapsed", ids: [] }
    : { mode: "expanded", ids: [] };
}

/** Reads a dot-separated path from an object and returns `undefined` when any segment is missing. */
export function getFieldValue(source: Record<string, unknown>, path: string): unknown {
  if (!path) {
    return undefined;
  }
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "false" && normalized !== "0" && normalized !== "no";
  }
  return Boolean(value);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function leftString(value: unknown, by: unknown): string {
  const text = String(value ?? "");
  if (typeof by === "number") {
    const count = Number.isFinite(by) ? Math.max(0, Math.trunc(by)) : 0;
    return text.slice(0, count);
  }
  const delimiter = String(by ?? "");
  const index = text.indexOf(delimiter);
  return index === -1 ? text : text.slice(0, index);
}

function rightString(value: unknown, by: unknown): string {
  const text = String(value ?? "");
  if (typeof by === "number") {
    const count = Number.isFinite(by) ? Math.max(0, Math.trunc(by)) : 0;
    return count === 0 ? "" : text.slice(-count);
  }
  const delimiter = String(by ?? "");
  const index = text.lastIndexOf(delimiter);
  return index === -1 ? text : text.slice(index + delimiter.length);
}

function getAttachmentList(doc: Record<string, unknown>): AttachmentLike[] {
  const attachments = doc._attachments;
  return Array.isArray(attachments) ? attachments as AttachmentLike[] : [];
}

/** Evaluates a single operation node after its arguments have been recursively resolved. */
function evaluateOperation(expression: Extract<MindooDBAppExpression, { kind: "operation" }>, context: EvaluationContext): unknown {
  const args = expression.args.map((arg) => evaluateExpression(arg, context));
  switch (expression.op) {
    case "decryptionKeyId":
      return context.decryptionKeyId ?? null;
    case "attachmentNames":
      return getAttachmentList(context.doc)
        .map((attachment) => attachment.fileName)
        .filter((value): value is string => typeof value === "string");
    case "attachmentLengths":
      return getAttachmentList(context.doc)
        .map((attachment) => attachment.size)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    case "attachmentCount":
      return getAttachmentList(context.doc).length;
    case "add":
      return (toNumber(args[0]) ?? 0) + (toNumber(args[1]) ?? 0);
    case "sub":
      return (toNumber(args[0]) ?? 0) - (toNumber(args[1]) ?? 0);
    case "mul":
      return (toNumber(args[0]) ?? 0) * (toNumber(args[1]) ?? 0);
    case "div": {
      const divisor = toNumber(args[1]);
      return divisor && divisor !== 0 ? (toNumber(args[0]) ?? 0) / divisor : null;
    }
    case "mod": {
      const divisor = toNumber(args[1]);
      return divisor && divisor !== 0 ? (toNumber(args[0]) ?? 0) % divisor : null;
    }
    case "eq":
      return args[0] === args[1];
    case "neq":
      return args[0] !== args[1];
    case "gt":
      return String(args[0] ?? "") > String(args[1] ?? "");
    case "gte":
      return String(args[0] ?? "") >= String(args[1] ?? "");
    case "lt":
      return String(args[0] ?? "") < String(args[1] ?? "");
    case "lte":
      return String(args[0] ?? "") <= String(args[1] ?? "");
    case "and":
      return args.every((value) => toBoolean(value));
    case "or":
      return args.some((value) => toBoolean(value));
    case "not":
      return !toBoolean(args[0]);
    case "concat":
      return args.filter((part) => part !== null && part !== undefined && part !== "").join("");
    case "lower":
      return String(args[0] ?? "").toLowerCase();
    case "upper":
      return String(args[0] ?? "").toUpperCase();
    case "trim":
      return String(args[0] ?? "").trim();
    case "left":
      return leftString(args[0], args[1]);
    case "right":
      return rightString(args[0], args[1]);
    case "number":
      return toNumber(args[0]);
    case "string":
      return String(args[0] ?? "");
    case "boolean":
      return toBoolean(args[0]);
    case "contains":
      return String(args[0] ?? "").toLowerCase().includes(String(args[1] ?? "").toLowerCase());
    case "startsWith":
      return String(args[0] ?? "").toLowerCase().startsWith(String(args[1] ?? "").toLowerCase());
    case "endsWith":
      return String(args[0] ?? "").toLowerCase().endsWith(String(args[1] ?? "").toLowerCase());
    case "coalesce":
      return args.find((value) => value !== null && value !== undefined && value !== "");
    case "exists":
      return args[0] !== null && args[0] !== undefined && args[0] !== "";
    case "notExists":
      return args[0] === null || args[0] === undefined || args[0] === "";
    case "pathJoin":
      return args
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join("\\");
    case "datePart": {
      const date = toDate(args[0]);
      if (!date) {
        return null;
      }
      switch (expression.part) {
        case "year":
          return date.getUTCFullYear();
        case "month":
          return String(date.getUTCMonth() + 1).padStart(2, "0");
        case "day":
          return String(date.getUTCDate()).padStart(2, "0");
        case "quarter":
          return `Q${Math.ceil((date.getUTCMonth() + 1) / 3)}`;
        default:
          return null;
      }
    }
  }
}

/**
 * Evaluates an expression against a document plus the current view/value
 * context. This is the runtime counterpart of the builder and parser.
 */
export function evaluateExpression(expression: MindooDBAppExpression, context: EvaluationContext): unknown {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "field":
      return getFieldValue(context.doc, expression.path);
    case "value":
      return getFieldValue(context.values, expression.path);
    case "origin":
      return context.origin;
    case "variable":
      return context.variables[expression.name];
    case "if":
      return toBoolean(evaluateExpression(expression.condition, context))
        ? evaluateExpression(expression.whenTrue, context)
        : evaluateExpression(expression.whenFalse, context);
    case "let": {
      const nextVariables = { ...context.variables };
      for (const [name, valueExpression] of Object.entries(expression.bindings)) {
        nextVariables[name] = evaluateExpression(valueExpression, {
          ...context,
          variables: nextVariables,
        });
      }
      return evaluateExpression(expression.result, {
        ...context,
        variables: nextVariables,
      });
    }
    case "operation":
      return evaluateOperation(expression, context);
  }
}

function compareValues(left: unknown, right: unknown, sorting = "ascending") {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    const result = leftNumber - rightNumber;
    return sorting === "descending" ? -result : result;
  }
  const result = String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
  return sorting === "descending" ? -result : result;
}

/** Computes all column values for one document from left to right. */
function computeRowValues(
  definition: MindooDBAppViewDefinition,
  document: Record<string, unknown>,
  origin: string,
  decryptionKeyId?: string | null,
) {
  const values: Record<string, unknown> = {};
  for (const column of definition.columns) {
    values[column.name] = evaluateExpression(column.expression, {
      doc: document,
      values,
      origin,
      decryptionKeyId,
      variables: {},
    });
  }
  return values;
}

/** Applies the optional view filter before row materialization. */
function matchesFilter(
  filter: MindooDBAppBooleanExpression | undefined,
  document: Record<string, unknown>,
  origin: string,
  decryptionKeyId?: string | null,
) {
  if (!filter) {
    return true;
  }
  return toBoolean(evaluateExpression(filter, {
    doc: document,
    values: {},
    origin,
    decryptionKeyId,
    variables: {},
  }));
}

/** Adds a row to the tree and wires it into the parent/child indexes. */
function addRow(target: ViewTree, row: InternalRow, parentKey: string | null) {
  target.rowsByKey.set(row.key, row);
  if (parentKey) {
    target.rowsByKey.get(parentKey)?.childKeys.push(row.key);
  } else {
    target.rootKeys.push(row.key);
  }
  if (row.type === "category") {
    target.categoryKeys.push(row.key);
  }
}

/** Recursively groups computed rows into the category/document tree. */
function buildRowsRecursive(
  tree: ViewTree,
  definition: MindooDBAppViewDefinition,
  rows: Array<{ docId: string; values: Record<string, unknown> }>,
  categoryIndex: number,
  level: number,
  parentKey: string | null,
  prefix: string[],
) {
  const categoryColumns = definition.columns.filter((column) => column.role === "category");
  const categoryColumn = categoryColumns[categoryIndex];
  if (!categoryColumn) {
    for (const row of rows) {
      addRow(tree, {
        key: row.docId,
        type: "document",
        level,
        docId: row.docId,
        parentKey,
        categoryPath: prefix,
        values: row.values,
        descendantDocumentCount: 1,
        childKeys: [],
      }, parentKey);
    }
    return;
  }

  const grouped = new Map<string, Array<{ docId: string; values: Record<string, unknown> }>>();
  for (const row of rows) {
    const value = String(row.values[categoryColumn.name] ?? "");
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }

  const orderedGroups = Array.from(grouped.entries()).sort(([left], [right]) =>
    compareValues(left, right, categoryColumn.sorting ?? "ascending"));
  for (const [categoryValue, children] of orderedGroups) {
    const categoryPath = [...prefix, categoryValue];
    const categoryKey = categoryPath.join("::");
    addRow(tree, {
      key: categoryKey,
      type: "category",
      level,
      docId: null,
      parentKey,
      categoryPath,
      values: { [categoryColumn.name]: categoryValue },
      descendantDocumentCount: children.length,
      expanded: definition.defaultExpand !== "collapsed",
      childKeys: [],
    }, parentKey);
    buildRowsRecursive(tree, definition, children, categoryIndex + 1, level + 1, categoryKey, categoryPath);
  }
}

/** Materializes a complete view tree from raw documents and the declarative definition. */
function buildViewTree(
  definition: MindooDBAppViewDefinition,
  documents: Array<{ id: string; data: Record<string, unknown>; decryptionKeyId?: string | null }>,
  origin: string,
): ViewTree {
  const sortableColumns = definition.columns.filter((column) => column.role !== "total");
  const computedRows = documents
    .filter((document) => matchesFilter(definition.filter?.expression, document.data, origin, document.decryptionKeyId))
    .map((document) => ({
      docId: document.id,
      values: computeRowValues(definition, document.data, origin, document.decryptionKeyId),
    }));

  computedRows.sort((left, right) => {
    for (const column of sortableColumns) {
      const result = compareValues(left.values[column.name], right.values[column.name], column.sorting ?? "ascending");
      if (result !== 0) {
        return result;
      }
    }
    return left.docId.localeCompare(right.docId);
  });

  const tree: ViewTree = {
    rowsByKey: new Map(),
    rootKeys: [],
    categoryKeys: [],
  };

  buildRowsRecursive(tree, definition, computedRows, 0, 0, null, []);
  return tree;
}

function isExpanded(rowKey: string, expansion: MindooDBAppViewExpansionState) {
  const hasRow = expansion.ids.includes(rowKey);
  return expansion.mode === "expanded" ? !hasRow : hasRow;
}

/** Flattens the tree into the visible row order for the current expansion state. */
function collectVisibleRows(tree: ViewTree, expansion: MindooDBAppViewExpansionState, rootRowKey?: string | null) {
  const result: MindooDBAppViewRow[] = [];
  const visit = (rowKey: string, includeSelf: boolean) => {
    const row = tree.rowsByKey.get(rowKey);
    if (!row) {
      return;
    }
    const visibleRow: MindooDBAppViewRow = {
      key: row.key,
      type: row.type,
      level: includeSelf ? row.level : 0,
      docId: row.docId,
      parentKey: includeSelf ? row.parentKey : null,
      categoryPath: includeSelf ? row.categoryPath : row.categoryPath.slice(-1),
      values: row.values,
      descendantDocumentCount: row.descendantDocumentCount,
      expanded: row.type === "category" ? isExpanded(row.key, expansion) : undefined,
    };
    if (includeSelf) {
      result.push(visibleRow);
    }
    if (row.type === "category" && isExpanded(row.key, expansion)) {
      for (const childKey of row.childKeys) {
        visit(childKey, true);
      }
    }
  };

  if (rootRowKey) {
    const row = tree.rowsByKey.get(rootRowKey);
    if (!row) {
      return [];
    }
    for (const childKey of row.childKeys) {
      visit(childKey, true);
    }
    return result;
  }

  for (const rowKey of tree.rootKeys) {
    visit(rowKey, true);
  }
  return result;
}

/** Applies offset-based paging to an already ordered row list. */
function pageRows(rows: MindooDBAppViewRow[], pageSize = 100, position?: string | null): MindooDBAppViewPageResult {
  const startIndex = position ? Number.parseInt(position, 10) || 0 : 0;
  const safePageSize = Math.max(1, pageSize);
  const pageRowsResult = rows.slice(startIndex, startIndex + safePageSize);
  return {
    rows: pageRowsResult,
    nextPosition: startIndex + pageRowsResult.length < rows.length ? String(startIndex + pageRowsResult.length) : null,
    hasMore: startIndex + pageRowsResult.length < rows.length,
  };
}

/** Builds and pages the visible rows for a full view request. */
export function pageViewRows(
  definition: MindooDBAppViewDefinition,
  documents: Array<{ id: string; data: Record<string, unknown>; decryptionKeyId?: string | null }>,
  origin: string,
  request?: MindooDBAppViewPageRequest,
  fallbackExpansion?: MindooDBAppViewExpansionState,
) {
  const expansion = request?.expansion ?? fallbackExpansion ?? getDefaultExpansionState(definition);
  const tree = buildViewTree(definition, documents, origin);
  const rows = collectVisibleRows(tree, expansion, request?.rootRowKey);
  return pageRows(rows, request?.pageSize, request?.position);
}

/** Returns a single row by key from the fully materialized tree. */
export function getViewRow(
  definition: MindooDBAppViewDefinition,
  documents: Array<{ id: string; data: Record<string, unknown>; decryptionKeyId?: string | null }>,
  origin: string,
  rowKey: string,
) {
  return buildViewTree(definition, documents, origin).rowsByKey.get(rowKey) ?? null;
}

/** Resolves a category row by its full path segments. */
export function getCategoryRowByPath(
  definition: MindooDBAppViewDefinition,
  documents: Array<{ id: string; data: Record<string, unknown>; decryptionKeyId?: string | null }>,
  origin: string,
  path: string[],
) {
  return buildViewTree(definition, documents, origin).rowsByKey.get(path.join("::")) ?? null;
}

/** Pages only the visible children below a specific category row. */
export function pageCategoryRows(
  definition: MindooDBAppViewDefinition,
  documents: Array<{ id: string; data: Record<string, unknown>; decryptionKeyId?: string | null }>,
  origin: string,
  categoryKey: string,
  expansion: MindooDBAppViewExpansionState,
  request?: { pageSize?: number; position?: string | null },
) {
  const tree = buildViewTree(definition, documents, origin);
  const category = tree.rowsByKey.get(categoryKey);
  if (!category || category.type !== "category") {
    return {
      rows: [],
      nextPosition: null,
      hasMore: false,
    } satisfies MindooDBAppViewPageResult;
  }
  const rows = collectVisibleRows(tree, expansion, categoryKey);
  return pageRows(rows, request?.pageSize, request?.position);
}

/** Collects all leaf document ids reachable from a category or document row. */
function collectDocumentIds(tree: ViewTree, rowKey: string, target: string[]) {
  const row = tree.rowsByKey.get(rowKey);
  if (!row) {
    return;
  }
  if (row.type === "document" && row.docId) {
    target.push(row.docId);
    return;
  }
  for (const childKey of row.childKeys) {
    collectDocumentIds(tree, childKey, target);
  }
}

/** Lists the document ids contained below a category row. */
export function listCategoryDocumentIds(
  definition: MindooDBAppViewDefinition,
  documents: Array<{ id: string; data: Record<string, unknown>; decryptionKeyId?: string | null }>,
  origin: string,
  categoryKey: string,
) {
  const tree = buildViewTree(definition, documents, origin);
  const result: string[] = [];
  collectDocumentIds(tree, categoryKey, result);
  return result;
}

/** Updates expansion state using the include/exclude semantics of the current mode. */
export function updateExpansionState(
  expansion: MindooDBAppViewExpansionState,
  rowKey: string,
  action: "expand" | "collapse",
): MindooDBAppViewExpansionState {
  const ids = new Set(expansion.ids);
  const currentlyExpanded = isExpanded(rowKey, expansion);
  if (action === "expand" && currentlyExpanded) {
    return expansion;
  }
  if (action === "collapse" && !currentlyExpanded) {
    return expansion;
  }

  if (expansion.mode === "expanded") {
    if (action === "expand") {
      ids.delete(rowKey);
    } else {
      ids.add(rowKey);
    }
  } else if (action === "expand") {
    ids.add(rowKey);
  } else {
    ids.delete(rowKey);
  }

  return {
    mode: expansion.mode,
    ids: Array.from(ids),
  };
}
