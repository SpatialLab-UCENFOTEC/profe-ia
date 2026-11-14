import { useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import type { Message } from "../../types";
import { MessageItem, StreamingMessage } from "./MessageItem";

export function MessageList({
  messages,
  isLoading,
  streamingHtml,
  streamingSummary,
}: {
  messages: Message[];
  isLoading: boolean;
  streamingHtml: string | null;
  streamingSummary: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingSummary, isLoading]);

  return (
    <div className="message-list" aria-live="polite">
      {messages.map((message) => <MessageItem key={message.id} message={message} />)}
      <AnimatePresence>
        {isLoading && <StreamingMessage key="streaming" streamingHtml={streamingHtml} streamingSummary={streamingSummary} />}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}
