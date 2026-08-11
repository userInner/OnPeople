import { Check, ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

export function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
}: CustomSelectProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];
  const enabledIndices = useMemo(
    () => options.flatMap((option, index) => (option.disabled ? [] : [index])),
    [options],
  );

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 176), 360);
    const estimatedHeight = Math.min(options.length * 42 + 8, 292);
    const roomBelow = window.innerHeight - rect.bottom;
    const top =
      roomBelow >= estimatedHeight + 12
        ? rect.bottom + 6
        : Math.max(8, rect.top - estimatedHeight - 6);
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );
    setPosition({ top, left, width });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const activeOption = menuRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    updatePosition();
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (enabledIndices.length === 0) return;
    const current = enabledIndices.indexOf(activeIndex);
    const next =
      current === -1
        ? direction === 1
          ? 0
          : enabledIndices.length - 1
        : (current + direction + enabledIndices.length) % enabledIndices.length;
    const nextIndex = enabledIndices[next];
    if (nextIndex !== undefined) setActiveIndex(nextIndex);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      if (enabledIndices[0] !== undefined) setActiveIndex(enabledIndices[0]);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      const last = enabledIndices.at(-1);
      if (last !== undefined) setActiveIndex(last);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab" && open) {
      setOpen(false);
    }
  };

  const menuStyle: CSSProperties | undefined = position
    ? { top: position.top, left: position.left, width: position.width }
    : undefined;

  return (
    <div className={`custom-select ${className}`.trim()} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={menuId}
        aria-activedescendant={
          open ? `${menuId}-option-${activeIndex}` : undefined
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`custom-select-trigger ${open ? "is-open" : ""}`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? "请选择"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && position
        ? createPortal(
            <div
              id={menuId}
              ref={menuRef}
              role="listbox"
              aria-label={ariaLabel}
              className="custom-select-menu"
              style={menuStyle}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;
                return (
                  <button
                    id={`${menuId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    data-option-index={index}
                    className={`custom-select-option ${isActive ? "is-active" : ""}`}
                    key={option.value}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                  >
                    <span className="custom-select-check">
                      {isSelected ? (
                        <Check size={14} aria-hidden="true" />
                      ) : null}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      {option.description ? (
                        <small>{option.description}</small>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
