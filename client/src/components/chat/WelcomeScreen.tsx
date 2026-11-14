import { motion } from "motion/react";
import { SUGGESTIONS } from "../../constants";
import { dropIn, pressable, riseIn, stagger } from "../../motion";

export function WelcomeScreen({ onSuggestion }: { onSuggestion: (suggestion: string) => void }) {
  return (
    <motion.div className="welcome" variants={stagger(0.08, 0.15)} initial="hidden" animate="show" exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}>
      <motion.div className="welcome-icon" variants={dropIn}><img src="/university-logo.png" alt="Logo de la universidad" /></motion.div>
      <motion.p className="eyebrow" variants={riseIn}>SpatialLab</motion.p>
      <motion.h2 variants={riseIn}>Describe el mundo que quieres crear</motion.h2>
      <motion.p variants={riseIn}>ProfeIA escribe la experiencia, te explica cada decisión y la muestra mientras se está construyendo.</motion.p>
      <motion.div className="suggestions" variants={stagger(0.07, 0.05)}>
        {SUGGESTIONS.map((suggestion) => (
          <motion.button key={suggestion} variants={riseIn} onClick={() => onSuggestion(suggestion)} {...pressable}>
            {suggestion}
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
}
