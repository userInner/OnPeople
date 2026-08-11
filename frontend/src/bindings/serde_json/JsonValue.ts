/** JSON value emitted by Rust DTOs that intentionally remain schemaless. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
