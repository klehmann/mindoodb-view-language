# MindooDB App View Language

The MindooDB app view language is the declarative expression system for defining derived columns and filters in app-defined views. It replaces both raw field paths and free-form JavaScript with a typed, composable builder API that compiles to a JSON-safe AST.

## Why a dedicated language?

Traditional approaches to view formulas have well-known drawbacks:

- **Raw field paths** are too limited for derived values, conditional logic, or formatting.
- **Free-form JavaScript strings** are hard to validate, impossible to autocomplete, and dangerous to execute in a shared host context.
- **Hand-written JSON ASTs** are verbose and error-prone without tooling.

The MindooDB view language solves all three by giving you a strongly typed TypeScript builder where:

- every helper guides you toward valid expressions through autocomplete and compiler checks
- `field()` paths are validated against your document type at compile time
- the output is a plain JSON object that travels safely over `postMessage` without executing code in the host
- the language can be extended with new helpers and AST nodes without breaking existing definitions

If you have used HCL Notes/Domino formulas before, think of this as the modern equivalent: a focused expression system designed for document views, but with TypeScript type safety instead of string parsing.

## Getting started

Import `createViewLanguage` from `mindoodb-view-language`. If you are already using `mindoodb-app-sdk`, you can also import the same API from there because the SDK re-exports it.

```ts
import { createViewLanguage } from "mindoodb-view-language";

type TimeRecord = {
  employee: string;
  workDate: string;
  hours: number;
  rate?: number;
  note?: string;
  project?: {
    name: string;
    code: string;
  };
};

const v = createViewLanguage<TimeRecord>();
```

Every helper on `v` returns an expression object. Expression objects are composable: you can pass any expression as an argument to any other helper that accepts an expression. You can also pass raw literal values directly for helper arguments, and the builder will wrap them as literal expressions for you. The result is always a JSON-serializable tree that the bridge evaluates at runtime.

The package also exports structured helper metadata via `mindooDBViewLanguageHelpers`, `mindooDBViewLanguageHelpersByName`, and `getMindooDBViewLanguageHelper()`. This metadata is intended for editor integrations such as autocomplete, signature help, and inline helper documentation in the Administrator.

### The second type parameter

`createViewLanguage` accepts an optional second generic for the value context. The value context represents the values computed by earlier columns in the same view, which you can reference with `value()`.

```ts
type ValueContext = {
  amount: number;
};

const v = createViewLanguage<TimeRecord, ValueContext>();

const taxRate = v.mul(v.value("amount"), v.number(0.19));
```

If you omit the second parameter, `value()` accepts any string path without compile-time checking.

## Core concepts

### Expressions compose

Every helper returns an expression. Every helper that takes input accepts expressions. This means you can nest them freely:

```ts
const formatted = v.concat(
  v.upper(v.field("employee")),
  v.string(" - "),
  v.datePart(v.field("workDate"), "month"),
);
```

### Column evaluation order

Columns in a view definition are evaluated left to right. A column can reference values computed by earlier columns using `value()`. This is useful when one column's result feeds into another.

### Filters use the same language

Filters are boolean expressions built with the same helpers. The only difference is that the top-level expression must evaluate to a boolean.

### Formula source syntax in editors

The Administrator's Formula editor uses a builder-call source syntax such as `v.eq(v.field("status"), "approved")`. That source is parsed into the same AST that `createViewLanguage()` produces in TypeScript.

This means there are two equivalent ways to think about the language:

- In application code, you usually build expressions with the typed `v.*` helpers from `createViewLanguage()`. Helper arguments can be either expressions or raw literal values.
- In the Administrator editor, you usually write the same helper calls directly as Formula source text.

Raw literals are valid directly in Formula source, and the TypeScript builder accepts the same shorthand for helper arguments. You do not need to wrap simple constants with `v.string()`, `v.number()`, or `v.boolean()` unless you prefer that style or want to make the literal explicit.

```ts
v.eq(v.field("status"), "approved")
v.gt(v.toNumber(v.field("hours")), 0)
v.and(
  v.exists(v.field("note")),
  v.neq(v.field("note"), ""),
)
v.literal({ status: "draft", tags: ["review"], active: true })
```

When you use the `Prettify` action in the Administrator, the formatter keeps helper calls but normalizes simple constants to raw literal shorthand. For example, `v.eq(v.field("status"), v.string("approved"))` becomes `v.eq(v.field("status"), "approved")`.

In TypeScript, the builder produces the same AST either way:

```ts
v.eq(v.field("status"), "approved")
v.eq(v.field("status"), v.string("approved"))
```

Both forms compile to the same literal expression on the right-hand side.

---

## Function reference

### Literals and constants

#### `literal(value)`

Wraps any JSON-compatible value as a constant expression.

- **Arguments:** `value` - any serializable value (string, number, boolean, null, array, object)
- **Returns:** expression resolving to the given value
- **Shorthand note:** in both editor-authored Formula source and TypeScript helper arguments, simple literals can usually be written directly as `"hello"`, `42`, `true`, `null`, arrays, or objects. Use `v.literal(...)` when you want to make the constant explicit.

```ts
v.literal("hello")       // "hello"
v.literal(42)            // 42
v.literal(null)          // null
v.literal(["a", "b"])    // ["a", "b"]

"hello"
42
null
["a", "b"]
```

#### `string(value)`

Shorthand for `literal()` that restricts the argument to a string.

- **Arguments:** `value: string`
- **Returns:** `Expression<string>`
- **Shorthand note:** `"approved"` is equivalent to `v.string("approved")` in both editor-authored Formula source and TypeScript helper arguments. Prettify prefers the raw string literal form.

```ts
v.string("approved")
```

#### `number(value)`

Shorthand for `literal()` that restricts the argument to a number.

- **Arguments:** `value: number`
- **Returns:** `Expression<number>`
- **Shorthand note:** `123` is equivalent to `v.number(123)` in both editor-authored Formula source and TypeScript helper arguments. Prettify prefers the raw numeric form.

```ts
v.number(0)
v.number(100.5)
```

#### `boolean(value)`

Shorthand for `literal()` that restricts the argument to a boolean.

- **Arguments:** `value: boolean`
- **Returns:** `BooleanExpression`
- **Shorthand note:** `true` and `false` are equivalent to `v.boolean(true)` and `v.boolean(false)` in both editor-authored Formula source and TypeScript helper arguments. Prettify prefers the raw boolean form.

```ts
v.boolean(true)
v.boolean(false)
```

---

### Field and context access

#### `field(path)`

Reads a value from the source document by dot-separated path. The path is checked against your document type at compile time, so `v.field("nonexistent")` produces a TypeScript error.

- **Arguments:** `path` - a dot-separated field path (e.g. `"employee"`, `"project.name"`)
- **Returns:** expression resolving to the field's value, or `undefined` if the path does not exist at runtime

```ts
v.field("employee")       // reads doc.employee
v.field("project.name")   // reads doc.project.name (nested access)
v.field("hours")          // reads doc.hours
```

#### `value(path)`

Reads a value from the current column evaluation context. This is used to reference a value computed by an earlier column in the same view.

- **Arguments:** `path` - a dot-separated path into the value context
- **Returns:** expression resolving to the previously computed value

```ts
v.value("amount")  // reads the "amount" column's computed value
```

#### `origin()`

Returns the origin identifier for the current document source. This is an internal string assigned by the Administrator that identifies where the document comes from (e.g. `"tenant/database"`). Useful for multi-source views.

- **Arguments:** none
- **Returns:** `Expression<string>`

```ts
v.origin()
```

---

### Type conversion

#### `toNumber(expr)`

Converts the expression result to a number. Strings are parsed as numbers. Non-numeric values produce `null`.

- **Arguments:** `expr` - any expression
- **Returns:** `Expression<number | null>`
- **Runtime behavior:** returns the number if the input is already numeric; parses strings with `Number()`; returns `null` for empty strings, non-numeric strings, `undefined`, `null`, booleans, and objects

```ts
v.toNumber(v.field("hours"))      // 8 if hours is 8
v.toNumber(v.string("3.5"))       // 3.5
v.toNumber(v.string("abc"))       // null
v.toNumber(v.literal(undefined))  // null
```

#### `toString(expr)`

Converts the expression result to a string using `String()`.

- **Arguments:** `expr` - any expression
- **Returns:** `Expression<string>`
- **Runtime behavior:** `null` and `undefined` become `""`

```ts
v.toString(v.number(42))          // "42"
v.toString(v.field("hours"))      // "8"
```

#### `toBoolean(expr)`

Converts the expression result to a boolean using truthiness rules.

- **Arguments:** `expr` - any expression
- **Returns:** `BooleanExpression`
- **Runtime behavior:** `false`, `0`, `""`, `"false"`, `"0"`, `"no"`, `null`, and `undefined` are falsy; everything else is truthy

```ts
v.toBoolean(v.field("hours"))     // true if hours > 0
v.toBoolean(v.string(""))         // false
```

---

### Arithmetic

All arithmetic helpers convert their arguments to numbers first using the same rules as `toNumber()`. Non-numeric values are treated as `0`.

#### `add(left, right)`

Adds two values.

- **Returns:** `Expression<number>`

```ts
v.add(v.field("hours"), v.number(2))  // hours + 2
```

#### `sub(left, right)`

Subtracts the right value from the left.

- **Returns:** `Expression<number>`

```ts
v.sub(v.field("hours"), v.number(1))  // hours - 1
```

#### `mul(left, right)`

Multiplies two values.

- **Returns:** `Expression<number>`

```ts
v.mul(v.field("hours"), v.field("rate"))  // hours * rate
```

#### `div(left, right)`

Divides the left value by the right. Returns `null` if the divisor is zero or non-numeric.

- **Returns:** `Expression<number>`
- **Runtime behavior:** division by zero returns `null`, not an error

```ts
v.div(v.field("total"), v.field("count"))
```

#### `mod(left, right)`

Returns the remainder of dividing the left value by the right. Returns `null` if the divisor is zero or non-numeric.

- **Returns:** `Expression<number>`

```ts
v.mod(v.field("index"), v.number(2))  // 0 for even, 1 for odd
```

---

### Comparisons

Comparison helpers compare two expression results and return a boolean.

#### `eq(left, right)`

Strict equality (`===`).

- **Returns:** `BooleanExpression`

```ts
v.eq(v.field("status"), v.string("approved"))
```

#### `neq(left, right)`

Strict inequality (`!==`).

- **Returns:** `BooleanExpression`

```ts
v.neq(v.field("status"), v.string("draft"))
```

#### `gt(left, right)`, `gte(left, right)`, `lt(left, right)`, `lte(left, right)`

String-based ordering comparisons. Both arguments are coerced to strings and compared lexicographically.

- **Returns:** `BooleanExpression`
- **Runtime behavior:** uses string comparison, so `"9" > "10"` is `true`. Use `toNumber()` first if you need numeric ordering.

```ts
v.gt(v.toNumber(v.field("hours")), v.number(0))
v.lte(v.field("workDate"), v.string("2026-12-31"))
```

---

### Boolean logic

#### `and(...conditions)`

Returns `true` if all conditions are truthy. Accepts any number of boolean expressions.

- **Arguments:** variadic `BooleanExpression` arguments
- **Returns:** `BooleanExpression`

```ts
v.and(
  v.exists(v.field("employee")),
  v.gt(v.toNumber(v.field("hours")), v.number(0)),
)
```

#### `or(...conditions)`

Returns `true` if at least one condition is truthy.

- **Arguments:** variadic `BooleanExpression` arguments
- **Returns:** `BooleanExpression`

```ts
v.or(
  v.eq(v.field("status"), v.string("approved")),
  v.eq(v.field("status"), v.string("pending")),
)
```

#### `not(condition)`

Negates a boolean expression.

- **Arguments:** `condition: BooleanExpression`
- **Returns:** `BooleanExpression`

```ts
v.not(v.exists(v.field("note")))  // true if note is missing
```

---

### String operations

#### `concat(...parts)`

Joins multiple values into a single string. `null`, `undefined`, and empty strings are silently skipped.

- **Arguments:** variadic expressions
- **Returns:** `Expression<string>`

```ts
v.concat(v.field("employee"), v.string(" - "), v.field("note"))
// "Ada - Planning" if both fields exist
// "Ada" if note is empty (empty parts are skipped)
```

#### `lower(expr)`

Converts a value to lowercase.

- **Arguments:** `expr` - any expression (coerced to string)
- **Returns:** `Expression<string>`

```ts
v.lower(v.field("employee"))  // "ada" if employee is "Ada"
```

#### `upper(expr)`

Converts a value to uppercase.

- **Arguments:** `expr` - any expression (coerced to string)
- **Returns:** `Expression<string>`

```ts
v.upper(v.field("status"))  // "APPROVED"
```

#### `trim(expr)`

Removes leading and trailing whitespace.

- **Arguments:** `expr` - any expression (coerced to string)
- **Returns:** `Expression<string>`

```ts
v.trim(v.field("note"))
```

#### `left(value, by)`

Returns the left portion of a string.

- **Arguments:**
  - `value` - any expression (coerced to string)
  - `by` - either a number or a delimiter string
- **Returns:** `Expression<string>`
- **Runtime behavior:**
  - if `by` is a number, returns the first `by` characters
  - if `by` is a string, returns everything before the first occurrence of that delimiter
  - if the delimiter is not found, returns the original string

```ts
v.left(v.field("code"), 2)     // "xy" for "xyz_d"
v.left(v.field("code"), "_d")  // "xyz" for "xyz_d"
v.left(v.field("code"), "d")   // "xyz_" for "xyz_d_aaxd"
```

#### `right(value, by)`

Returns the right portion of a string.

- **Arguments:**
  - `value` - any expression (coerced to string)
  - `by` - either a number or a delimiter string
- **Returns:** `Expression<string>`
- **Runtime behavior:**
  - if `by` is a number, returns the last `by` characters
  - if `by` is a string, returns everything after the last occurrence of that delimiter
  - if the delimiter is not found, returns the original string

```ts
v.right(v.field("code"), 2)    // "_d" for "xyz_d"
v.right(v.field("code"), "_")  // "d" for "xyz_d"
```

#### `contains(haystack, needle)`

Returns `true` if the haystack string contains the needle. Case-insensitive.

- **Arguments:** `haystack` and `needle` - any expressions (coerced to strings)
- **Returns:** `BooleanExpression`

```ts
v.contains(v.field("note"), v.string("meeting"))
```

#### `startsWith(value, prefix)`

Returns `true` if the value starts with the prefix. Case-insensitive.

- **Arguments:** `value` and `prefix` - any expressions (coerced to strings)
- **Returns:** `BooleanExpression`

```ts
v.startsWith(v.field("employee"), v.string("A"))
```

#### `endsWith(value, suffix)`

Returns `true` if the value ends with the suffix. Case-insensitive.

- **Arguments:** `value` and `suffix` - any expressions (coerced to strings)
- **Returns:** `BooleanExpression`

```ts
v.endsWith(v.field("employee"), v.string("son"))
```

---

### Null handling and existence

#### `coalesce(...expressions)`

Returns the first non-null, non-undefined, non-empty-string value from the arguments. Useful for providing fallback values.

- **Arguments:** variadic expressions of the same type
- **Returns:** expression of the same type as the arguments

```ts
v.coalesce(v.field("note"), v.string("No note"))
v.coalesce(v.toNumber(v.field("rate")), v.number(1))
```

#### `exists(expr)`

Returns `true` if the value is not `null`, not `undefined`, and not an empty string.

- **Arguments:** `expr` - any expression
- **Returns:** `BooleanExpression`

```ts
v.exists(v.field("note"))
```

#### `notExists(expr)`

Returns `true` if the value is `null`, `undefined`, or an empty string.

- **Arguments:** `expr` - any expression
- **Returns:** `BooleanExpression`

```ts
v.notExists(v.field("rate"))  // true if rate is missing
```

---

### Date helpers

#### `datePart(expr, part)`

Extracts a component from a date value. The input can be an ISO date string, a timestamp number, or a Date object.

- **Arguments:**
  - `expr` - expression resolving to a date-like value
  - `part` - one of `"year"`, `"month"`, `"day"`, `"quarter"`
- **Returns:** `Expression<string | number | null>`
- **Return values by part:**
  - `"year"` returns the four-digit year as a number (e.g. `2026`)
  - `"month"` returns a zero-padded two-digit string (e.g. `"04"` for April)
  - `"day"` returns a zero-padded two-digit string (e.g. `"03"`)
  - `"quarter"` returns a string like `"Q1"`, `"Q2"`, `"Q3"`, or `"Q4"`
- **Runtime behavior:** returns `null` if the input cannot be parsed as a valid date

```ts
v.datePart(v.field("workDate"), "year")     // 2026
v.datePart(v.field("workDate"), "month")    // "04"
v.datePart(v.field("workDate"), "day")      // "03"
v.datePart(v.field("workDate"), "quarter")  // "Q2"
```

---

### Path helpers

#### `pathJoin(...parts)`

Joins multiple values into a backslash-separated path string. Each part is trimmed; empty parts are skipped.

- **Arguments:** variadic expressions (coerced to strings)
- **Returns:** `Expression<string>`

```ts
v.pathJoin(v.field("project.code"), v.field("employee"))
// "PRJ001\\Ada"
```

---

### Control flow

#### `ifElse(condition, whenTrue, whenFalse)`

Evaluates the condition and returns `whenTrue` if truthy, `whenFalse` otherwise. This is the primary branching construct, equivalent to the Notes `@If` formula.

- **Arguments:**
  - `condition: BooleanExpression`
  - `whenTrue: Expression<T>` - returned when the condition is truthy
  - `whenFalse: Expression<T>` - returned when the condition is falsy
- **Returns:** `Expression<T>`

```ts
const label = v.ifElse(
  v.exists(v.field("note")),
  v.concat(v.field("employee"), v.string(": "), v.field("note")),
  v.field("employee"),
);
// "Ada: Planning" if note exists, "Ada" otherwise
```

Nested branching is also supported:

```ts
const priority = v.ifElse(
  v.gt(v.toNumber(v.field("hours")), v.number(8)),
  v.string("overtime"),
  v.ifElse(
    v.gt(v.toNumber(v.field("hours")), v.number(4)),
    v.string("full"),
    v.string("partial"),
  ),
);
```

---

### Intermediate values

#### `let(bindings, buildResult)`

Defines named intermediate values and passes them to a builder function. This avoids repeating complex sub-expressions and makes formulas more readable.

- **Arguments:**
  - `bindings` - an object mapping names to expressions
  - `buildResult` - a function that receives typed references to the bindings and returns the final expression
- **Returns:** expression of the type returned by `buildResult`

The binding references passed to `buildResult` are strongly typed: if you bind `hours` to a `toNumber()` expression, the reference is typed as `Expression<number | null>`.

```ts
const amount = v.let(
  {
    hours: v.toNumber(v.field("hours")),
    rate: v.coalesce(v.toNumber(v.field("rate")), v.number(1)),
  },
  ({ hours, rate }) => v.mul(
    v.coalesce(hours, v.number(0)),
    v.coalesce(rate, v.number(0)),
  ),
);
```

You can nest `let()` for more complex formulas:

```ts
const netAmount = v.let(
  {
    subtotal: v.mul(v.toNumber(v.field("hours")), v.coalesce(v.toNumber(v.field("rate")), v.number(1))),
  },
  ({ subtotal }) => v.let(
    {
      tax: v.mul(subtotal, v.number(0.19)),
    },
    ({ tax }) => v.sub(subtotal, tax),
  ),
);
```

---

## Common patterns

### Handling optional fields

Use `coalesce()` to provide defaults for fields that might be missing:

```ts
const rate = v.coalesce(v.toNumber(v.field("rate")), v.number(1));
const note = v.coalesce(v.field("note"), v.string("(no note)"));
```

### Building display labels from multiple fields

```ts
const displayName = v.concat(
  v.field("employee"),
  v.string(" / "),
  v.datePart(v.field("workDate"), "month"),
  v.string("-"),
  v.datePart(v.field("workDate"), "year"),
);
// "Ada / 04-2026"
```

### Filtering by multiple conditions

```ts
const filter = {
  mode: "expression" as const,
  expression: v.and(
    v.gt(v.toNumber(v.field("hours")), v.number(0)),
    v.neq(v.field("status"), v.string("cancelled")),
    v.exists(v.field("employee")),
  ),
};
```

### Numeric comparisons

Because `gt()`, `lt()`, etc. use string comparison by default, always wrap numeric fields in `toNumber()` first when comparing magnitudes:

```ts
v.gt(v.toNumber(v.field("hours")), v.number(4))
// correct: compares 8 > 4 numerically

v.gt(v.field("hours"), v.number(4))
// incorrect: compares "8" > "4" as strings (happens to work here, but "10" < "4" as strings)
```

### Categorizing by date

```ts
const columns = [
  {
    name: "quarter",
    title: "Quarter",
    role: "category" as const,
    expression: v.concat(
      v.toString(v.datePart(v.field("workDate"), "year")),
      v.string(" "),
      v.datePart(v.field("workDate"), "quarter"),
    ),
    sorting: "ascending" as const,
  },
];
// Produces category labels like "2026 Q2"
```

---

## Using expressions in view definitions

Expressions are embedded directly into the `expression` field of column definitions and the `expression` field of the filter object.

```ts
const view = await db.views.create({
  title: "Billable records by employee",
  defaultExpand: "collapsed",
  filter: {
    mode: "expression",
    expression: v.gt(v.toNumber(v.field("hours")), v.number(0)),
  },
  columns: [
    {
      name: "employee",
      title: "Employee",
      role: "category",
      expression: v.field("employee"),
      sorting: "ascending",
    },
    {
      name: "month",
      title: "Month",
      role: "display",
      expression: v.datePart(v.field("workDate"), "month"),
      sorting: "ascending",
    },
    {
      name: "amount",
      title: "Amount",
      role: "display",
      expression: v.let(
        {
          hours: v.toNumber(v.field("hours")),
          rate: v.coalesce(v.toNumber(v.field("rate")), v.number(1)),
        },
        ({ hours, rate }) => v.mul(
          v.coalesce(hours, v.number(0)),
          v.coalesce(rate, v.number(0)),
        ),
      ),
      sorting: "descending",
    },
    {
      name: "label",
      title: "Label",
      role: "display",
      expression: v.ifElse(
        v.exists(v.field("note")),
        v.concat(v.field("employee"), v.string(": "), v.field("note")),
        v.field("employee"),
      ),
    },
  ],
});
```

---

## Type safety

The builder is designed so the easy path is the correct one:

- `field("employee")` is checked against the document type you pass to `createViewLanguage<T>()`. Typos and invalid paths produce TypeScript errors.
- Nested paths like `field("project.name")` are validated against the nested type structure.
- `let()` gives you typed references to intermediate results, so you get autocomplete and type checking inside the builder callback.
- Boolean-returning helpers like `eq()`, `and()`, `exists()` return `BooleanExpression`, which `ifElse()` and filter definitions require as their condition. Passing a non-boolean expression as a condition is a compile-time error.
- All expressions are plain JSON objects. There are no functions, classes, or non-serializable values in the output.

This means most mistakes show up in TypeScript before the view definition ever reaches the bridge.

---

## First-iteration limits

The first declarative-only iteration does not try to model every possible formula concept. In particular:

- There is no custom app-provided JS execution.
- There is no aggregation across documents (e.g. SUM of a column across all rows). Use the `totalMode` column property for simple sums and averages instead.
- The helper set is intentionally focused on common business-view cases.
- If we later need more power, we can extend the language by adding new helpers and AST nodes without breaking the transport format or existing definitions.
