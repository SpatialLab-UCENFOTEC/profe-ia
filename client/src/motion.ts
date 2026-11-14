import type { TargetAndTransition, Transition, Variants } from "motion/react";

// Presets compartidos: todo el movimiento de la app usa estos springs para que "pese" igual.

/** Entradas grandes (paneles, tarjetas, mensajes): masa alta, rebote marcado y asentamiento lento. */
export const heavy: Transition = { type: "spring", stiffness: 260, damping: 18, mass: 1.3 };

/** Botones, chips y popups: rápido y con salto. */
export const jumpy: Transition = { type: "spring", stiffness: 520, damping: 14, mass: 0.9 };

/** Salidas: sin rebote, para que lo que se va no distraiga. */
export const exit: Transition = { type: "spring", stiffness: 420, damping: 36, mass: 1 };

/** Cae desde arriba y aterriza con squash & stretch. */
export const dropIn: Variants = {
  hidden: { opacity: 0, y: -48, scaleX: 1, scaleY: 1 },
  show: {
    opacity: 1,
    y: 0,
    scaleY: [1.06, 0.9, 1.04, 1],
    scaleX: [0.96, 1.06, 0.98, 1],
    transition: {
      y: heavy,
      opacity: { duration: 0.2 },
      scaleX: { duration: 0.55, times: [0, 0.45, 0.75, 1], ease: "easeOut", delay: 0.18 },
      scaleY: { duration: 0.55, times: [0, 0.45, 0.75, 1], ease: "easeOut", delay: 0.18 },
    },
  },
};

/** Sube desde abajo con un leve escalado. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { ...heavy, opacity: { duration: 0.22 } } },
};

/** Aparece desde casi nada con un salto. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: { opacity: 1, scale: 1, transition: { ...jumpy, opacity: { duration: 0.15 } } },
  exit: { opacity: 0, scale: 0.7, transition: exit },
};

export function stagger(gap = 0.06, delayChildren = 0.05): Variants {
  return { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren } } };
}

/** Interacción estándar de botones: se levanta al pasar y se hunde al presionar. */
export const pressable = {
  whileHover: { y: -3, transition: jumpy },
  whileTap: { scale: 0.93, y: 1, transition: jumpy },
} as const;

/** Sacudida horizontal amortiguada (errores). */
export const shake: TargetAndTransition = {
  x: [0, -12, 10, -6, 4, -2, 0],
  transition: { duration: 0.5, ease: "easeOut" },
};
