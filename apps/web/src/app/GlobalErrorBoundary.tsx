import { Component, type ErrorInfo, type ReactNode } from "react";

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
}

export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  override state: GlobalErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GlobalErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Power View UI failed safely.", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error" role="alert">
          <span className="brand-mark" aria-hidden="true">
            PV
          </span>
          <h1>Power View needs to reload.</h1>
          <p>Jira data was not changed. Reload the extension page to restore the view.</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => globalThis.location?.reload()}
          >
            Reload Power View
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
