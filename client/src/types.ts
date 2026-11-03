export type Role = "user" | "model";
export type PreviewMode = "closed" | "split" | "fullscreen";
export type AuthState = "checking" | "locked" | "authenticated";
export type PreviewStatus = "idle" | "generating" | "patching" | "checking" | "ready" | "repairing" | "repair-failed";

/** Versiones antes/después de un parche, para animar las líneas que cambian en el código fantasma. */
export interface GhostDiff {
  id: string;
  before: string;
  after: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  html?: string;
  internal?: boolean;
  corrections?: string[];
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "status"; phase: "patching" | "patch-fallback" }
  | { type: "final"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
