import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DayOffToggle } from "./DayOffToggle";

describe("DayOffToggle", () => {
  it("grants GitHub storage access without marking a date and prevents repeated connection clicks", () => {
    const onConnect = vi.fn();
    const onChange = vi.fn();
    const view = render(
      <DayOffToggle
        day="2026-11-02"
        checked={false}
        disabled
        onConnect={onConnect}
        onChange={onChange}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Allow GitHub storage access for Day off 2026-11-02",
    });
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(
      <DayOffToggle
        day="2026-11-02"
        checked={false}
        connecting
        onConnect={onConnect}
        onChange={onChange}
      />,
    );
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
  it("reports a change and reflects the controlled value", () => {
    const onChange = vi.fn();
    const view = render(
      <DayOffToggle day="2026-11-02" checked={false} onChange={onChange} />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Day off 2026-11-02" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(checkbox).not.toBeChecked();
    view.rerender(<DayOffToggle day="2026-11-02" checked={true} onChange={onChange} />);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("does not change or submit a surrounding form when disabled", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <DayOffToggle day="2026-11-02" checked disabled onChange={onChange} />
      </form>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Day off 2026-11-02" });
    expect(checkbox).toBeDisabled();
    fireEvent.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
