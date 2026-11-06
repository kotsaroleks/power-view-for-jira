import { useLayoutEffect, useRef, type ReactNode } from "react";

export function WorklogDialog({
  label,
  onClose,
  restoreFocus,
  children,
}: {
  label: string;
  onClose: () => void;
  restoreFocus: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const restore = useRef(restoreFocus);
  restore.current = restoreFocus;
  useLayoutEffect(() => {
    const dialog = panel.current!;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      restore.current();
    };
  }, []);
  return (
    <dialog
      ref={panel}
      className="worklog-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
