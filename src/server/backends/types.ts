export type Kind = "graphs" | "problems";

/** Where JSON documents are kept. Ids are validated before they reach a backend. */
export interface StorageBackend {
  /** The document text, or null if it doesn't exist. */
  read(kind: Kind, id: string): Promise<string | null>;
  write(kind: Kind, id: string, text: string): Promise<void>;
  /** Ids of all stored documents of this kind. */
  list(kind: Kind): Promise<string[]>;
  /** Delete a document; no error if it doesn't exist. */
  remove(kind: Kind, id: string): Promise<void>;
}

export class StorageError extends Error {}
