export type ChatRole = "user" | "model";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type GenerateReply = (messages: ChatMessage[]) => Promise<string>;
