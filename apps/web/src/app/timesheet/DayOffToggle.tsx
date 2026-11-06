export interface DayOffToggleProps {
  day: string;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string | undefined;
  onConnect?: (() => void) | undefined;
  connecting?: boolean;
  onChange: (checked: boolean) => void;
}

export function DayOffToggle({
  day,
  checked,
  disabled,
  onChange,
  onConnect,
  connecting,
  disabledReason,
}: DayOffToggleProps) {
  if (onConnect)
    return (
      <button
        type="button"
        className="timesheet-day-off-toggle"
        aria-label={`Allow GitHub storage access for Day off ${day}`}
        title="Allow application access to GitHub storage, then select the date."
        disabled={connecting}
        onClick={onConnect}
      >
        {connecting ? "Connecting…" : "Day off · Allow GitHub storage access"}
      </button>
    );
  return (
    <label
      className="timesheet-day-off-toggle"
      title={
        disabled
          ? (disabledReason ?? "Day Off data must be complete before changing this date.")
          : "Mark this date as a day off"
      }
    >
      <input
        type="checkbox"
        aria-label={`Day off ${day}`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          if (!disabled) onChange(event.target.checked);
        }}
      />
      <span>Day off</span>
    </label>
  );
}
