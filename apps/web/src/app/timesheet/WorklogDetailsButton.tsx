import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function WorklogDetailsButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const id = useId();
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    below: boolean;
  }>();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepVisible = () => clearTimeout(hideTimer.current);
  const hideSoon = () => {
    keepVisible();
    hideTimer.current = setTimeout(() => setPosition(undefined), 150);
  };
  const show = (button: HTMLButtonElement) => {
    keepVisible();
    const bounds = button.getBoundingClientRect();
    const below = bounds.top < 80;
    const halfWidth = Math.min(260, window.innerWidth - 24) / 2;
    setPosition({
      left: Math.max(
        halfWidth + 12,
        Math.min(window.innerWidth - halfWidth - 12, bounds.left + bounds.width / 2),
      ),
      top: below ? bounds.bottom + 8 : bounds.top - 8,
      below,
    });
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const visible = Boolean(position);
  useEffect(() => {
    if (!visible) return;
    const hide = () => setPosition(undefined);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [visible]);
  return (
    <>
      <button
        type="button"
        className="weekly-cell-details"
        tabIndex={-1}
        aria-label={label}
        aria-describedby={position ? id : undefined}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={hideSoon}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => {
          keepVisible();
          setPosition(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && visible) {
            event.preventDefault();
            event.stopPropagation();
            setPosition(undefined);
          }
        }}
        onClick={(event) => {
          keepVisible();
          setPosition(undefined);
          onOpen(event.currentTarget);
        }}
      >
        ⋯
      </button>
      {position
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              className="worklog-details-tooltip"
              data-placement={position.below ? "bottom" : "top"}
              style={{ left: position.left, top: position.top }}
              onMouseEnter={keepVisible}
              onMouseLeave={hideSoon}
            >
              <strong>Worklog details</strong>
              Edit description, start time or delete this entry.
              <small>Alt + ↓ from the hours field</small>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
