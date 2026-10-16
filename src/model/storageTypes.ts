/** Summary of a file stored on the server, as listed by GET /api. */
export interface StoredEntry {
  id: string;
  name: string;
  updatedAt: string;
  /** For problems: the graph they refer to. */
  graphId?: string;
}
