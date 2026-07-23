# Accessibility review

The Gantt is exposed as one ARIA grid with a complete row count even when DOM rows are
virtualized. Issue rows and task bars are buttons, expansion exposes `aria-expanded`, zoom
and filter logic use `aria-pressed`, filter values use native checkboxes, and dynamic
counts/errors use status or alert regions.

Dependency lines are supplemental and hidden from assistive technology. The selected issue
details list dependencies as links, while blocked work has the visible word “Blocked”, a
row risk marker, a bordered task bar, and an accessible task-bar label. Color is therefore
not the only signal.

Keyboard focus uses a high-contrast outline on interactive Gantt controls. Native
`details`, form controls, links, and buttons preserve browser keyboard behavior. The UI
honors `prefers-reduced-motion`; Today scrolling becomes instant and CSS transitions are
effectively disabled.

Before a release, manually verify:

- complete operation with Tab, Shift+Tab, Space, Enter, and arrow keys where native;
- visible focus at 200% browser zoom and at a 320 CSS-pixel viewport;
- meaningful reading order and labels in VoiceOver or NVDA;
- blocked/conflict understanding without color;
- no focus loss after filtering, mutation refresh, or error recovery.

The interactive timeline itself is not a replacement for the synchronized issue table and
selected-task details; those remain the primary accessible representation.
