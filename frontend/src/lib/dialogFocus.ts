import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function focusableDialogElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

export function trapDialogTabKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  container: HTMLElement,
): void {
  if (event.key !== "Tab") return;
  const elements = focusableDialogElements(container);
  if (elements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  const first = elements[0]!;
  const last = elements.at(-1)!;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (active === last || !container.contains(active))
  ) {
    event.preventDefault();
    first.focus();
  }
}

export function captureDialogReturnFocus(): () => void {
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  return () => {
    if (!previous?.isConnected) return;
    window.requestAnimationFrame(() => previous.focus());
  };
}

export function handleDialogKeyDown(
  event: KeyboardEvent,
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (container.current) trapDialogTabKey(event, container.current);
}

export function useDialogFocus(
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    const restoreFocus = captureDialogReturnFocus();
    const onKeyDown = (event: KeyboardEvent) =>
      handleDialogKeyDown(event, container, () => onCloseRef.current());
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      restoreFocus();
    };
  }, [active, container]);
}
