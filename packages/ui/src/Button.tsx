import type { ButtonHTMLAttributes } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ children, ...properties }: ButtonProps) {
  return <button {...properties}>{children}</button>;
}
