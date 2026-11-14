import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { Icon } from "../Icon";
import { heavy, jumpy, riseIn } from "../../motion";

export function Composer({
  input,
  isLoading,
  error,
  textareaRef,
  onInputChange,
  onSend,
  onDismissError,
}: {
  input: string;
  isLoading: boolean;
  error: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onDismissError: () => void;
}) {
  const sendIcon = useAnimationControls();

  const send = () => {
    if (isLoading || !input.trim()) return;
    // El ícono "despega" y vuelve a su sitio con rebote.
    void sendIcon.start({
      x: [0, 14, -10, 0],
      y: [0, -14, 10, 0],
      opacity: [1, 0, 0, 1],
      transition: { duration: 0.55, times: [0, 0.35, 0.36, 1], ease: "easeOut" },
    });
    onSend();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <motion.div className="composer-wrap" variants={riseIn} initial="hidden" animate="show">
      <AnimatePresence>
        {error && (
          <motion.div
            key="error"
            role="alert"
            className="error-banner"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, x: [0, -10, 8, -5, 3, 0] }}
            exit={{ opacity: 0, y: 10, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ ...heavy, x: { duration: 0.5, delay: 0.15 } }}
          >
            <span>{error}</span><button onClick={onDismissError} aria-label="Cerrar aviso">✕</button>
          </motion.div>
        )}
      </AnimatePresence>
      <form onSubmit={handleSubmit} className="composer">
        <textarea ref={textareaRef} placeholder="Describe una experiencia o pide un cambio…" rows={1} maxLength={8000} value={input} onChange={(event) => onInputChange(event.target.value)} onKeyDown={handleKeyDown} disabled={isLoading} aria-label="Mensaje" />
        <motion.button
          type="submit"
          className="send-button"
          disabled={isLoading || !input.trim()}
          aria-label="Enviar mensaje"
          whileHover={{ scale: 1.08, rotate: -8, transition: jumpy }}
          whileTap={{ scale: 0.86, transition: jumpy }}
        >
          <motion.span animate={sendIcon} style={{ display: "grid" }}><Icon name="send" /></motion.span>
        </motion.button>
      </form>
      <p>Enter para enviar · Shift + Enter para nueva línea</p>
    </motion.div>
  );
}
