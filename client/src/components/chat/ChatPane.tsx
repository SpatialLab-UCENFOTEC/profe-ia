import type { RefObject } from "react";
import type { Message } from "../../types";
import { TopBar } from "../TopBar";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";

export function ChatPane({
  messages,
  isLoading,
  isPreviewVisible,
  showOpenPreview,
  streamingHtml,
  streamingSummary,
  input,
  error,
  textareaRef,
  onOpenPreview,
  onInputChange,
  onSend,
  onDismissError,
}: {
  messages: Message[];
  isLoading: boolean;
  isPreviewVisible: boolean;
  showOpenPreview: boolean;
  streamingHtml: string | null;
  streamingSummary: string;
  input: string;
  error: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onOpenPreview: () => void;
  onInputChange: (value: string) => void;
  onSend: (content: string) => void;
  onDismissError: () => void;
}) {
  return (
    <section className={`chat-pane ${isPreviewVisible ? "with-preview" : ""}`}>
      <TopBar showOpenPreview={showOpenPreview} onOpenPreview={onOpenPreview} />
      <div className="conversation">
        {messages.length === 0 ? (
          <WelcomeScreen onSuggestion={onSend} />
        ) : (
          <MessageList messages={messages} isLoading={isLoading} streamingHtml={streamingHtml} streamingSummary={streamingSummary} />
        )}
      </div>
      <Composer input={input} isLoading={isLoading} error={error} textareaRef={textareaRef} onInputChange={onInputChange} onSend={() => onSend(input)} onDismissError={onDismissError} />
    </section>
  );
}
