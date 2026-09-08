import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type Role = "user" | "model";

interface Message {
  id: string;
  role: Role;
  content: string;
}

const SUGGESTIONS = [
  "Explícame un concepto difícil con una analogía",
  "Ayúdame a organizar mi semana",
  "Dame una idea creativa para un proyecto",
];

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M12 1.8c.4 5.5 4.7 9.8 10.2 10.2-5.5.4-9.8 4.7-10.2 10.2C11.6 16.7 7.3 12.4 1.8 12 7.3 11.6 11.6 7.3 12 1.8Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 12 16-8-6.2 16-2.4-6.4L4 12Z" />
      <path strokeLinecap="round" d="m11.4 13.6 3.7-3.7" />
    </svg>
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = async (content: string) => {
    const cleanContent = content.trim();
    if (!cleanContent || isLoading) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: cleanContent };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || !data.reply) {
        throw new Error(data.error || "No se pudo completar la solicitud.");
      }
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "model", content: data.reply! },
      ]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ocurrió un error inesperado.");
    } finally {
      setIsLoading(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-base-100 text-base-content">
      <div className="orb orb-one" />
      <div className="orb orb-two" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-7 sm:py-7">
        <header className="navbar min-h-0 rounded-2xl border border-white/8 bg-base-200/60 px-4 py-3 shadow-xl backdrop-blur-xl">
          <div className="flex-1 gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-content shadow-lg shadow-primary/20">
              <SparkleIcon />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-tight tracking-tight">Orbit</h1>
              <p className="text-xs text-base-content/50">Tu espacio para pensar con Gemini</p>
            </div>
          </div>
          <div className="flex-none">
            <div className="badge badge-success badge-sm gap-1.5 border-success/20 bg-success/10 px-3 py-3 text-success">
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              En línea
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-end py-6 sm:py-10">
          {messages.length === 0 ? (
            <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
              <div className="mb-7 grid size-16 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-2xl shadow-primary/10">
                <SparkleIcon />
              </div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-[0.24em] text-primary">Una conversación a la vez</p>
              <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">¿Qué quieres explorar?</h2>
              <p className="mt-4 max-w-lg text-base leading-relaxed text-base-content/55">
                Pregunta, crea o resuelve. Gemini está listo para ayudarte a convertir una idea en el siguiente paso.
              </p>
              <div className="mt-9 grid w-full gap-2.5 sm:grid-cols-3">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="btn h-auto min-h-20 justify-start whitespace-normal border-white/8 bg-base-200/60 px-4 py-3 text-left text-sm font-normal leading-snug hover:border-primary/30 hover:bg-primary/10"
                    onClick={() => void sendMessage(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-5" aria-live="polite">
              {messages.map((message) => (
                <div key={message.id} className={`chat ${message.role === "user" ? "chat-end" : "chat-start"}`}>
                  <div className="chat-header mb-1.5 text-xs text-base-content/40">
                    {message.role === "user" ? "Tú" : "Orbit"}
                  </div>
                  <div
                    className={`chat-bubble max-w-[88%] whitespace-pre-wrap text-[15px] leading-relaxed sm:max-w-[78%] ${
                      message.role === "user"
                        ? "chat-bubble-primary shadow-lg shadow-primary/10"
                        : "border border-white/8 bg-base-200 text-base-content"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="chat chat-start">
                  <div className="chat-header mb-1.5 text-xs text-base-content/40">Orbit</div>
                  <div className="chat-bubble border border-white/8 bg-base-200 py-4">
                    <span className="loading loading-dots loading-sm text-primary" aria-label="Gemini está respondiendo" />
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="sticky bottom-0 mx-auto w-full max-w-3xl pb-1">
          {error && (
            <div role="alert" className="alert alert-error mb-3 border-error/20 bg-error/10 py-3 text-sm text-error-content">
              <span>{error}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setError(null)} aria-label="Cerrar aviso">✕</button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="composer flex items-end gap-2 rounded-2xl border border-white/10 bg-base-200/90 p-2 shadow-2xl backdrop-blur-xl focus-within:border-primary/40">
            <textarea
              ref={textareaRef}
              className="textarea max-h-40 min-h-12 flex-1 resize-none border-0 bg-transparent px-3 py-3 leading-6 outline-none focus:outline-none"
              placeholder="Escribe un mensaje…"
              rows={1}
              maxLength={8000}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              aria-label="Mensaje"
            />
            <button
              type="submit"
              className="btn btn-primary btn-square size-12 rounded-xl shadow-lg shadow-primary/20"
              disabled={isLoading || !input.trim()}
              aria-label="Enviar mensaje"
            >
              <SendIcon />
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] text-base-content/35">Enter para enviar · Shift + Enter para nueva línea</p>
        </div>
      </section>
    </main>
  );
}
