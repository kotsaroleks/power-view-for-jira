import { useId } from "react";
import type { AppSection, AppSectionVisibility } from "@power-view/storage";

const sections: { id: AppSection; name: string; description: string }[] = [
  {
    id: "timesheet",
    name: "Timesheet",
    description: "Log your time and manage Day Off.",
  },
  { id: "gantt", name: "Gantt", description: "Plan schedules and dependencies." },
  {
    id: "status",
    name: "Status chart",
    description: "See issue statuses across your board.",
  },
  { id: "reports", name: "Reports", description: "Team updates and time reports." },
  {
    id: "estimation",
    name: "Estimation board",
    description: "Estimate scope and prepare handoffs.",
  },
];

export function SectionSettings({
  visibility,
  ready,
  busy,
  disabled,
  error,
  onChange,
}: {
  visibility: AppSectionVisibility;
  ready: boolean;
  busy: boolean;
  disabled: boolean;
  error: string;
  onChange: (section: AppSection, enabled: boolean) => Promise<void>;
}) {
  const id = useId();
  return (
    <section
      className="setup-card section-settings-card"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <div className="section-settings-heading">
        <h2 id={`${id}-title`}>App sections</h2>
        <p>
          Choose which sections appear in navigation and Workspace. Changes save
          automatically on this device.
        </p>
      </div>
      <div className="section-settings-list">
        {sections.map((section) => (
          <label className="section-toggle-row" key={section.id}>
            <span className="section-toggle-copy">
              <strong>{section.name}</strong>
              <span>{section.description}</span>
            </span>
            <span className="section-toggle-control">
              <span className="section-toggle-state" aria-hidden="true">
                {visibility[section.id] ? "On" : "Off"}
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={section.name}
                checked={visibility[section.id]}
                disabled={disabled}
                onChange={(event) => void onChange(section.id, event.target.checked)}
              />
              <span className="section-toggle-track" aria-hidden="true">
                <span />
              </span>
            </span>
          </label>
        ))}
      </div>
      {!ready || busy ? (
        <p className="section-settings-feedback" role="status">
          {busy ? "Saving section setting…" : "Loading section settings…"}
        </p>
      ) : null}
      {error ? (
        <p className="section-settings-feedback" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
