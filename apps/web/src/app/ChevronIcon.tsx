export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`people-report-chevron-icon${expanded ? " people-report-chevron-icon-expanded" : ""}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
