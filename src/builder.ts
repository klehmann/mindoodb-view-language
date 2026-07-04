// The typed expression builder moved into mindoodb core
// (`mindoodb/src/core/expressions/builder.ts`). This module re-exports it
// for compatibility.
export { createViewLanguage } from "mindoodb";
export type {
  MindooDBAppFieldPath,
  MindooDBAppPathValue,
  MindooDBAppExpressionInput,
} from "mindoodb";
