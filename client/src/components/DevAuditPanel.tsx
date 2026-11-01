import { DEV_SCENARIOS, type DevScenario } from "../dev/devScenarios";

export function DevAuditPanel({ disabled, onLoad }: { disabled: boolean; onLoad: (scenario: DevScenario) => void }) {
  return (
    <details className="dev-audit-panel">
      <summary>Auditar estados</summary>
      <div>
        <p>Respuestas locales predefinidas</p>
        {DEV_SCENARIOS.map(scenario => <button type="button" key={scenario.id} onClick={() => onLoad(scenario)} disabled={disabled}>{scenario.label}</button>)}
      </div>
    </details>
  );
}
