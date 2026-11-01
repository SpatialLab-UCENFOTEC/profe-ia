export type Role = "user" | "model";
export type PreviewMode = "closed" | "split" | "fullscreen";
export type AuthState = "checking" | "locked" | "authenticated";
export type PreviewStatus = "idle" | "generating" | "checking" | "ready" | "repairing" | "repair-failed";

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
  | { type: "final"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
