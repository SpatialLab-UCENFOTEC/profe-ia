import { useEffect, type FormEvent } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { dropIn, heavy, pressable, riseIn, shake, stagger } from "../motion";

export function AccessScreen({
  password,
  error,
  isSubmitting,
  onPasswordChange,
  onSubmit,
}: {
  password: string;
  error: string | null;
  isSubmitting: boolean;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const card = useAnimationControls();

  useEffect(() => {
    void card.start("show");
  }, [card]);

  // Contraseña incorrecta: la tarjeta se sacude.
  useEffect(() => {
    if (error) void card.start(shake);
  }, [error, card]);

  return (
    <main className="access-shell">
      <div className="orb orb-one" /><div className="orb orb-two" />
      <motion.section className="access-card" aria-labelledby="access-title" variants={dropIn} initial="hidden" animate={card}>
        <motion.div variants={stagger(0.07, 0.25)} initial="hidden" animate="show">
          <motion.div className="access-logo" variants={dropIn}><img src="/university-logo.png" alt="Logo de la universidad" /></motion.div>
          <motion.p className="eyebrow" variants={riseIn}>SpatialLab</motion.p>
          <motion.h1 id="access-title" variants={riseIn}>Acceso a ProfeIA</motion.h1>
          <motion.p className="access-description" variants={riseIn}>Ingresa la contraseña para comenzar a construir experiencias WebXR.</motion.p>
          <motion.form onSubmit={onSubmit} className="access-form" variants={riseIn}>
            <label htmlFor="access-password">Contraseña</label>
            <input
              id="access-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              disabled={isSubmitting}
            />
            <AnimatePresence>
              {error && (
                <motion.p
                  role="alert"
                  className="access-error"
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={heavy}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
            <motion.button type="submit" disabled={isSubmitting || !password} {...pressable}>
              {isSubmitting ? "Verificando…" : "Ingresar"}
            </motion.button>
          </motion.form>
        </motion.div>
      </motion.section>
    </main>
  );
}
