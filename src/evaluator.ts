import {
  collectDecryptRequests,
  evaluateExpression,
  expressionToBoolean,
  expressionToNumber,
  getFieldValue,
} from "mindoodb";
import type {
  MindooDBAppBooleanExpression,
  MindooDBAppViewDefinition,
  MindooDBAppViewExpansionState,
  MindooDBAppViewPageRequest,
  MindooDBAppViewPageResult,
  MindooDBAppViewRow,
} from "./types";

// Expression evaluation moved into mindoodb core; re-exported here for
// compatibility.
export { collectDecryptRequests, evaluateExpression, getFieldValue };
export type { DecryptRequest } from "mindoodb";

// -----------------------------------------------------------------------------
// In-memory view tree builder.
//
// DEPRECATED: prefer summary-backed ephemeral views via `db.queryView()` in
// mindoodb — they evaluate the same expression language without
// materializing documents and support incremental updates. This tree
// builder remains for compatibility with existing hosts (mindoodb-haven).
// -----------------------------------------------------------------------------

type InternalRow = MindooDBAppViewRow & {
  childKeys: string[];
};

type ViewTree = {
  rowsByKey: Map<string, InternalRow>;
  rootKeys: string[];
  categoryKeys: string[];
};

/**
 * One input document for view evaluation. `witnessed` / `awaitingWitness`
 * mirror the host runtime's per-document witness state (see the MindooDB SDK's
 * `MindooDoc.isWitnessed()` / `isAwaitingWitness()`): legacy docs (no store
 * `entryVersion`) are both `false`; a versioned local doc is
 * `awaitingWitness: true`; once witnessed it becomes `witnessed: true`.
 */
export type ViewEvaluatorDocument = {
  id: string;
  data: Record<string, unknown>;
  createdAt?: string | null;
  decryptionKeyId?: string | null;
  witnessed?: boolean;
  awaitingWitness?: boolean;
  /**
   * Plaintext for `_encrypted` fields referenced by `v.decryptField` /
   * `v.decryptJson`, keyed by field name. Resolved out-of-band by the host
   * runtime because decryption is async; see `collectDecryptRequests`.
   */
  decrypted?: Record<string, unknown>;
};

type ViewRowCountContext = {
  childCount: number;
  childCategoryCount: number;
  childDocumentCount: number;
  descendantCount: number;
  descendantCategoryCount: number;
  descendantDocumentCount: number;
  siblingCount: number;
};

/** Creates the initial category expansion mode for a view definition. */
export function getDefaultExpansionState(definition: MindooDBAppViewDefinition): MindooDBAppViewExpansionState {
  return definition.defaultExpand === "collapsed"
    ? { mode: "collapsed", ids: [] }
    : { mode: "expanded", ids: [] };
}

function compareValues(left: unknown, right: unknown, sorting = "ascending") {
  const leftNumber = expressionToNumber(left);
  const rightNumber = expressionToNumber(right);
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
  createdAt?: string | null,
  decryptionKeyId?: string | null,
  witnessed?: boolean,
  awaitingWitness?: boolean,
  decrypted?: Record<string, unknown>,
) {
  const values: Record<string, unknown> = {};
  for (const column of definition.columns) {
    values[column.name] = evaluateExpression(column.expression, {
      doc: document,
      values,
      origin,
      createdAt,
      decryptionKeyId,
      witnessed,
      awaitingWitness,
      decrypted,
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
  createdAt?: string | null,
  decryptionKeyId?: string | null,
  witnessed?: boolean,
  awaitingWitness?: boolean,
  decrypted?: Record<string, unknown>,
) {
  if (!filter) {
    return true;
  }
  return expressionToBoolean(evaluateExpression(filter, {
    doc: document,
    values: {},
    origin,
    createdAt,
    decryptionKeyId,
    witnessed,
    awaitingWitness,
    decrypted,
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
        childCount: 0,
        childCategoryCount: 0,
        childDocumentCount: 0,
        descendantCount: 0,
        descendantCategoryCount: 0,
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
      childCount: 0,
      childCategoryCount: 0,
      childDocumentCount: 0,
      descendantCount: 0,
      descendantCategoryCount: 0,
      descendantDocumentCount: children.length,
      expanded: definition.defaultExpand !== "collapsed",
      childKeys: [],
    }, parentKey);
    buildRowsRecursive(tree, definition, children, categoryIndex + 1, level + 1, categoryKey, categoryPath);
  }
}

function finalizeRowCounts(tree: ViewTree): void {
  console.warn("finalizeRowCounts: manually computing counts");

  const visit = (rowKey: string): ViewRowCountContext => {
    const row = tree.rowsByKey.get(rowKey);
    if (!row) {
      return {
        childCount: 0,
        childCategoryCount: 0,
        childDocumentCount: 0,
        descendantCount: 0,
        descendantCategoryCount: 0,
        descendantDocumentCount: 0,
        siblingCount: 0,
      };
    }

    let childCategoryCount = 0;
    let childDocumentCount = 0;
    let descendantCategoryCount = 0;
    let descendantDocumentCount = row.type === "document" ? (row.descendantDocumentCount ?? 0) : 0;

    for (const childKey of row.childKeys) {
      const child = tree.rowsByKey.get(childKey);
      const childCounts = visit(childKey);
      if (!child) {
        continue;
      }
      if (child.type === "category") {
        childCategoryCount += 1;
        descendantCategoryCount += 1 + childCounts.descendantCategoryCount;
        descendantDocumentCount += childCounts.descendantDocumentCount;
      } else {
        childDocumentCount += 1;
        descendantDocumentCount += 1;
      }
    }

    row.childCategoryCount = childCategoryCount;
    row.childDocumentCount = childDocumentCount;
    row.childCount = childCategoryCount + childDocumentCount;
    row.descendantCategoryCount = descendantCategoryCount;
    row.descendantDocumentCount = descendantDocumentCount;
    row.descendantCount = descendantCategoryCount + descendantDocumentCount;

    return {
      childCount: childCategoryCount + childDocumentCount,
      childCategoryCount,
      childDocumentCount,
      descendantCount: descendantCategoryCount + descendantDocumentCount,
      descendantCategoryCount,
      descendantDocumentCount,
      siblingCount: row.siblingCount ?? 0,
    };
  };

  for (const rowKey of tree.rootKeys) {
    visit(rowKey);
  }

  for (const row of tree.rowsByKey.values()) {
    const parent = row.parentKey ? tree.rowsByKey.get(row.parentKey) : null;
    row.siblingCount = parent?.childCount ?? tree.rootKeys.length;
  }
}

/** Materializes a complete view tree from raw documents and the declarative definition. */
function buildViewTree(
  definition: MindooDBAppViewDefinition,
  documents: ViewEvaluatorDocument[],
  origin: string,
): ViewTree {
  const sortableColumns = definition.columns.filter((column) => column.role !== "total");
  const computedRows = documents
    .filter((document) => matchesFilter(
      definition.filter?.expression,
      document.data,
      origin,
      document.createdAt,
      document.decryptionKeyId,
      document.witnessed,
      document.awaitingWitness,
      document.decrypted,
    ))
    .map((document) => ({
      docId: document.id,
      values: computeRowValues(
        definition,
        document.data,
        origin,
        document.createdAt,
        document.decryptionKeyId,
        document.witnessed,
        document.awaitingWitness,
        document.decrypted,
      ),
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
  finalizeRowCounts(tree);
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
      childCount: row.childCount ?? 0,
      childCategoryCount: row.childCategoryCount ?? 0,
      childDocumentCount: row.childDocumentCount ?? 0,
      descendantCount: row.descendantCount ?? row.descendantDocumentCount,
      descendantCategoryCount: row.descendantCategoryCount ?? 0,
      descendantDocumentCount: row.descendantDocumentCount,
      siblingCount: row.siblingCount ?? 0,
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
  documents: ViewEvaluatorDocument[],
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
  documents: ViewEvaluatorDocument[],
  origin: string,
  rowKey: string,
) {
  return buildViewTree(definition, documents, origin).rowsByKey.get(rowKey) ?? null;
}

/** Resolves a category row by its full path segments. */
export function getCategoryRowByPath(
  definition: MindooDBAppViewDefinition,
  documents: ViewEvaluatorDocument[],
  origin: string,
  path: string[],
) {
  return buildViewTree(definition, documents, origin).rowsByKey.get(path.join("::")) ?? null;
}

/** Pages only the visible children below a specific category row. */
export function pageCategoryRows(
  definition: MindooDBAppViewDefinition,
  documents: ViewEvaluatorDocument[],
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
  documents: ViewEvaluatorDocument[],
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
