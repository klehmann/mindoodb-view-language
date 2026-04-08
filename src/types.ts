/** Sort direction used when ordering category or display columns. */
export type MindooDBAppViewSortDirection = "ascending" | "descending" | "none";
/** Semantic role of a column inside the rendered view tree. */
export type MindooDBAppViewColumnRole = "category" | "display" | "total";
/** Aggregate mode used for total columns. */
export type MindooDBAppViewTotalMode = "sum" | "average" | "none";
/** Date fragments that can be extracted with `datePart()`. */
export type MindooDBAppViewExpressionDatePart = "year" | "month" | "day" | "quarter";
/** Low-level operation identifiers used by AST operation nodes. */
export type MindooDBAppViewExpressionOperation =
  | "decryptionKeyId"
  | "attachmentNames"
  | "attachmentLengths"
  | "attachmentCount"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "and"
  | "or"
  | "not"
  | "concat"
  | "lower"
  | "upper"
  | "trim"
  | "left"
  | "right"
  | "number"
  | "string"
  | "boolean"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "coalesce"
  | "exists"
  | "notExists"
  | "pathJoin"
  | "datePart";

/**
 * Marker interface carried by every expression node.
 *
 * `__resultType` is never populated at runtime. It only exists so TypeScript
 * can track the value type that flows through expression builders.
 */
export interface MindooDBAppViewExpressionBase {
  readonly __resultType?: unknown;
}

/** Constant value embedded directly into the expression tree. */
export interface MindooDBAppViewLiteralExpression<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "literal";
  value: T;
}

/** Reads a value from the source document using a dot-separated path. */
export interface MindooDBAppViewFieldExpression<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "field";
  path: string;
}

/** Reads a value computed by an earlier column in the same view evaluation pass. */
export interface MindooDBAppViewValueExpressionRef<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "value";
  path: string;
}

/** Exposes the origin identifier of the document currently being evaluated. */
export interface MindooDBAppViewOriginExpression extends MindooDBAppViewExpressionBase {
  kind: "origin";
}

/** References a variable introduced by a surrounding `let()` binding. */
export interface MindooDBAppViewVariableExpression<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "variable";
  name: string;
}

/** Generic operation node used for arithmetic, boolean, string, and path helpers. */
export interface MindooDBAppViewOperationExpression<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "operation";
  op: MindooDBAppViewExpressionOperation;
  args: MindooDBAppExpression[];
  part?: MindooDBAppViewExpressionDatePart;
}

/** Branching node created by `ifElse()`. */
export interface MindooDBAppViewIfExpression<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "if";
  condition: MindooDBAppBooleanExpression;
  whenTrue: MindooDBAppExpression<T>;
  whenFalse: MindooDBAppExpression<T>;
}

/** Introduces named intermediate expressions that can be reused in the result branch. */
export interface MindooDBAppViewLetExpression<T = unknown> extends MindooDBAppViewExpressionBase {
  kind: "let";
  bindings: Record<string, MindooDBAppExpression>;
  result: MindooDBAppExpression<T>;
}

/** Union of all supported expression node kinds in the MindooDB Formula AST. */
export type MindooDBAppExpression<T = unknown> =
  | MindooDBAppViewLiteralExpression<T>
  | MindooDBAppViewFieldExpression<T>
  | MindooDBAppViewValueExpressionRef<T>
  | MindooDBAppViewOriginExpression
  | MindooDBAppViewVariableExpression<T>
  | MindooDBAppViewOperationExpression<T>
  | MindooDBAppViewIfExpression<T>
  | MindooDBAppViewLetExpression<T>;

/** Convenience alias for expressions that should evaluate to a boolean value. */
export type MindooDBAppBooleanExpression = MindooDBAppExpression<boolean>;

/** Column definition embedded in a view definition. */
export interface MindooDBAppViewColumn {
  name: string;
  title?: string;
  role: MindooDBAppViewColumnRole;
  expression: MindooDBAppExpression;
  sorting?: MindooDBAppViewSortDirection;
  hidden?: boolean;
  totalMode?: MindooDBAppViewTotalMode;
}

/** Optional filter expression applied before rows are materialized into the view tree. */
export interface MindooDBAppFilterDefinition {
  mode: "expression";
  expression: MindooDBAppBooleanExpression;
}

/** Expansion state for category rows in the rendered view tree. */
export interface MindooDBAppViewExpansionState {
  mode: "collapsed" | "expanded";
  ids: string[];
}

/** Complete declarative definition of an application view. */
export interface MindooDBAppViewDefinition {
  id?: string;
  title: string;
  filter?: MindooDBAppFilterDefinition;
  columns: MindooDBAppViewColumn[];
  defaultExpand?: "collapsed" | "expanded";
}

/** Paging request for the top-level view result surface. */
export interface MindooDBAppViewPageRequest {
  pageSize?: number;
  position?: string | null;
  expansion?: MindooDBAppViewExpansionState;
  rootRowKey?: string | null;
}

/** One visible row in the materialized category/document tree. */
export interface MindooDBAppViewRow {
  key: string;
  type: "category" | "document";
  level: number;
  docId: string | null;
  parentKey: string | null;
  categoryPath: string[];
  values: Record<string, unknown>;
  descendantDocumentCount: number;
  expanded?: boolean;
}

/** Paged result returned by view tree traversal helpers. */
export interface MindooDBAppViewPageResult {
  rows: MindooDBAppViewRow[];
  nextPosition: string | null;
  hasMore: boolean;
}

/** Category lookup request addressed by its full path segments. */
export interface MindooDBAppViewLookupByPath {
  path: string[];
}

/** Paging request for the children of a specific category row. */
export interface MindooDBAppViewCategoryChildrenPageRequest {
  pageSize?: number;
  position?: string | null;
}
