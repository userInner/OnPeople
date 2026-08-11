import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  active = false,
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""} ${className}`.trim()}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      {...props}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
    </button>
  );
}
