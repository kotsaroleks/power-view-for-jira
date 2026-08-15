import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom does not implement the Pointer Events capture API. Components that call
// setPointerCapture/releasePointerCapture/hasPointerCapture during real pointer
// interaction (e.g. Gantt drag handling) would otherwise throw under test even
// though real browsers support it.
if (typeof Element !== "undefined") {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
}

// jsdom also does not implement the PointerEvent constructor at all (confirmed:
// `window.PointerEvent` isn't a constructor as of jsdom 26). Testing Library's
// fireEvent.pointerDown/Move/Up falls back to a plain `Event` in that case, which
// silently drops pointer/mouse-specific init properties like clientX (the native
// Event constructor only recognizes bubbles/cancelable/composed) — so drag tests
// would see `undefined` coordinates with no visible error. Polyfill PointerEvent
// as a thin MouseEvent subclass, since jsdom's MouseEvent constructor does
// correctly carry clientX/clientY.
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    public pointerId: number;
    public pointerType: string;
    public isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }

  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  globalThis.PointerEvent = window.PointerEvent;
}
