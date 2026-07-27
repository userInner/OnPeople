(() => {
  "use strict";

  const enhancedSelects = new Set();
  const selectMetadata = new WeakMap();
  const dialogQueue = [];
  let activeDialog = null;
  let activeSelect = null;
  let selectPopover = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function ensureDialog() {
    let dialog = document.querySelector("#onpeople-action-dialog");
    if (dialog) return dialog;
    dialog = element("dialog", "op-dialog");
    dialog.id = "onpeople-action-dialog";
    dialog.setAttribute("aria-labelledby", "op-dialog-title");
    dialog.setAttribute("aria-describedby", "op-dialog-message");

    const card = element("form", "op-dialog-card");
    card.method = "dialog";
    const rail = element("i", "op-dialog-rail");
    rail.setAttribute("aria-hidden", "true");

    const header = element("header", "op-dialog-header");
    const identity = element("div", "op-dialog-identity");
    const mark = element("span", "op-dialog-mark");
    const image = document.createElement("img");
    image.src = "../assets/onpeople-app-icon.png";
    image.alt = "";
    const glyph = element("span", "op-dialog-glyph", "!");
    glyph.setAttribute("aria-hidden", "true");
    mark.append(image, glyph);
    const heading = element("div");
    const kicker = element("span", "op-dialog-kicker", "ONPEOPLE DECISION");
    kicker.id = "op-dialog-kicker";
    const title = element("h2", "", "确认操作");
    title.id = "op-dialog-title";
    heading.append(kicker, title);
    identity.append(mark, heading);
    const close = element("button", "op-dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    header.append(identity, close);

    const body = element("section", "op-dialog-body");
    const message = element("div", "op-dialog-message");
    message.id = "op-dialog-message";
    const input = element("input", "op-dialog-input");
    input.id = "op-dialog-input";
    input.autocomplete = "off";
    input.hidden = true;
    body.append(message, input);

    const footer = element("footer", "op-dialog-actions");
    const cancel = element("button", "op-dialog-cancel", "取消");
    cancel.type = "button";
    const confirm = element("button", "op-dialog-confirm", "继续");
    confirm.type = "submit";
    footer.append(cancel, confirm);
    card.append(rail, header, body, footer);
    dialog.append(card);
    document.body.append(dialog);

    const finish = (value) => {
      if (!activeDialog) return;
      const current = activeDialog;
      activeDialog = null;
      if (dialog.open) dialog.close();
      current.resolve(value);
      window.requestAnimationFrame(() => current.returnFocus?.focus?.({ preventScroll: true }));
      window.setTimeout(showNextDialog, 0);
    };
    close.addEventListener("click", () => finish(activeDialog?.cancelValue));
    cancel.addEventListener("click", () => finish(activeDialog?.cancelValue));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(activeDialog?.cancelValue);
    });
    card.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!activeDialog) return;
      finish(activeDialog.kind === "prompt" ? input.value : activeDialog.confirmValue);
    });
    return dialog;
  }

  function showNextDialog() {
    if (activeDialog || !dialogQueue.length) return;
    const dialog = ensureDialog();
    activeDialog = dialogQueue.shift();
    const options = activeDialog.options;
    dialog.dataset.tone = options.tone;
    dialog.querySelector("#op-dialog-kicker").textContent = options.kicker;
    dialog.querySelector("#op-dialog-title").textContent = options.title;
    const message = dialog.querySelector("#op-dialog-message");
    const paragraphs = activeDialog.message.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
    message.replaceChildren(...paragraphs.map((value, index) => {
      const paragraph = element("p", index ? "op-dialog-note" : "op-dialog-summary", value);
      return paragraph;
    }));
    const input = dialog.querySelector("#op-dialog-input");
    input.hidden = activeDialog.kind !== "prompt";
    input.value = activeDialog.defaultValue || "";
    input.placeholder = options.placeholder || "";
    const cancel = dialog.querySelector(".op-dialog-cancel");
    cancel.textContent = options.cancelLabel;
    cancel.hidden = activeDialog.kind === "alert";
    const confirm = dialog.querySelector(".op-dialog-confirm");
    confirm.textContent = options.confirmLabel;
    dialog.showModal();
    window.requestAnimationFrame(() => (activeDialog.kind === "prompt" ? input : confirm).focus());
  }

  function requestDialog(kind, message, options = {}) {
    const tone = ["neutral", "warning", "danger", "success"].includes(options.tone) ? options.tone : "neutral";
    const defaults = {
      neutral: { kicker: "ONPEOPLE DECISION", title: "确认这个操作？", confirmLabel: "继续" },
      warning: { kicker: "REVIEW BEFORE CONTINUING", title: "确认继续？", confirmLabel: "确认" },
      danger: { kicker: "HIGH IMPACT ACTION", title: "确认高影响操作？", confirmLabel: "确认继续" },
      success: { kicker: "ONPEOPLE", title: "操作完成", confirmLabel: "知道了" },
    }[tone];
    return new Promise((resolve) => {
      dialogQueue.push({
        kind,
        message: String(message || ""),
        defaultValue: String(options.defaultValue || ""),
        options: {
          tone,
          kicker: String(options.kicker || defaults.kicker),
          title: String(options.title || defaults.title),
          confirmLabel: String(options.confirmLabel || (kind === "alert" ? "知道了" : defaults.confirmLabel)),
          cancelLabel: String(options.cancelLabel || "取消"),
          placeholder: String(options.placeholder || ""),
        },
        confirmValue: kind === "alert" ? undefined : true,
        cancelValue: kind === "prompt" ? null : (kind === "alert" ? undefined : false),
        returnFocus: document.activeElement,
        resolve,
      });
      showNextDialog();
    });
  }

  function ensureSelectPopover() {
    if (selectPopover) return selectPopover;
    selectPopover = element("div", "op-select-popover");
    selectPopover.id = "onpeople-select-popover";
    selectPopover.setAttribute("popover", "manual");
    selectPopover.hidden = true;
    selectPopover.setAttribute("role", "listbox");
    document.body.append(selectPopover);
    selectPopover.addEventListener("keydown", (event) => {
      const items = [...selectPopover.querySelectorAll(".op-select-option:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeSelectPopover(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(index + delta + items.length) % items.length]?.focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      }
    });
    return selectPopover;
  }

  function selectedOption(select) {
    return select.options[select.selectedIndex] || [...select.options].find((option) => option.value === select.value) || null;
  }

  function selectLabel(select) {
    const selected = selectedOption(select);
    return selected?.label || selected?.textContent || select.getAttribute("placeholder") || "请选择";
  }

  function selectSignature(select) {
    return [...select.options]
      .map((option) => `${option.value}\0${option.label}\0${option.disabled}\0${option.hidden}\0${option.selected}`)
      .join("\u0001");
  }

  function syncSelect(select) {
    const meta = selectMetadata.get(select);
    if (!meta) return;
    if (!select.isConnected) {
      enhancedSelects.delete(select);
      selectMetadata.delete(select);
      if (activeSelect === select) closeSelectPopover();
      return;
    }
    const label = selectLabel(select);
    meta.label.textContent = label;
    meta.trigger.title = label;
    meta.trigger.disabled = select.disabled;
    meta.trigger.setAttribute("aria-disabled", String(select.disabled));
    meta.wrapper.hidden = select.hidden;
    meta.wrapper.dataset.empty = selectedOption(select) ? "false" : "true";
    const signature = selectSignature(select);
    if (activeSelect === select && selectPopoverVisible() && meta.signature !== signature) renderSelectOptions(select);
    meta.signature = signature;
  }

  function selectPopoverVisible() {
    if (!selectPopover) return false;
    try {
      return selectPopover.matches(":popover-open");
    } catch {
      return !selectPopover.hidden;
    }
  }

  function closeSelectPopover(restoreFocus = false) {
    if (!activeSelect) return;
    const meta = selectMetadata.get(activeSelect);
    meta?.trigger.setAttribute("aria-expanded", "false");
    if (selectPopoverVisible()) selectPopover.hidePopover?.();
    selectPopover.hidden = true;
    const previous = activeSelect;
    activeSelect = null;
    if (restoreFocus) selectMetadata.get(previous)?.trigger.focus({ preventScroll: true });
  }

  function placeSelectPopover(select) {
    const popover = ensureSelectPopover();
    const trigger = selectMetadata.get(select)?.trigger;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(340, Math.max(184, rect.width));
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
    const desiredHeight = Math.min(popover.scrollHeight, 320);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    if (below >= Math.min(180, desiredHeight) || below >= above) {
      popover.style.top = `${rect.bottom + 5}px`;
      popover.style.maxHeight = `${Math.max(96, below)}px`;
    } else {
      popover.style.top = `${Math.max(8, rect.top - desiredHeight - 5)}px`;
      popover.style.maxHeight = `${Math.max(96, above)}px`;
    }
  }

  function chooseOption(select, option) {
    if (select.disabled || option.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncSelect(select);
    closeSelectPopover(true);
  }

  function renderSelectOptions(select) {
    const popover = ensureSelectPopover();
    popover.replaceChildren();
    const fragment = document.createDocumentFragment();
    let selectedItem = null;
    for (const child of select.children) {
      if (child.tagName === "OPTGROUP") {
        const group = element("div", "op-select-group", child.label);
        fragment.append(group);
        for (const option of child.children) appendOption(option);
      } else if (child.tagName === "OPTION") {
        appendOption(child);
      }
    }
    function appendOption(option) {
      if (option.hidden) return;
      const item = element("button", "op-select-option");
      item.type = "button";
      item.disabled = option.disabled;
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.selected));
      const check = element("i", "", option.selected ? "✓" : "");
      check.setAttribute("aria-hidden", "true");
      const copy = element("span");
      const title = element("strong", "", option.label || option.textContent);
      copy.append(title);
      if (option.dataset.description) copy.append(element("small", "", option.dataset.description));
      item.append(check, copy);
      item.addEventListener("click", () => chooseOption(select, option));
      if (option.selected) selectedItem = item;
      fragment.append(item);
    }
    popover.append(fragment);
    placeSelectPopover(select);
    window.requestAnimationFrame(() => (selectedItem || popover.querySelector(".op-select-option:not(:disabled)"))?.focus());
  }

  function openSelectPopover(select) {
    if (select.disabled) return;
    if (activeSelect === select && selectPopoverVisible()) {
      closeSelectPopover(true);
      return;
    }
    closeSelectPopover();
    activeSelect = select;
    const meta = selectMetadata.get(select);
    meta.trigger.setAttribute("aria-expanded", "true");
    const popover = ensureSelectPopover();
    popover.hidden = false;
    popover.showPopover?.();
    renderSelectOptions(select);
  }

  function enhanceSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.multiple || select.dataset.onpeopleNative === "true" || enhancedSelects.has(select)) return;
    const wrapper = element("span", "op-select");
    wrapper.dataset.selectId = select.id || "";
    const trigger = element("button", "op-select-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const wrappingLabel = select.closest("label");
    const fieldLabel = select.getAttribute("aria-label")
      || document.querySelector(`label[for="${CSS.escape(select.id || "")}"]`)?.textContent?.trim()
      || wrappingLabel?.querySelector(":scope > span")?.textContent?.trim()
      || select.name
      || select.id
      || "选择选项";
    trigger.setAttribute("aria-label", fieldLabel);
    const label = element("span", "op-select-value");
    const chevron = element("span", "op-select-chevron", "⌄");
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(label, chevron);
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger);
    select.classList.add("op-native-select");
    select.tabIndex = -1;
    selectMetadata.set(select, { wrapper, trigger, label });
    enhancedSelects.add(select);
    trigger.addEventListener("click", () => openSelectPopover(select));
    trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openSelectPopover(select);
      }
    });
    select.addEventListener("change", () => syncSelect(select));
    select.addEventListener("input", () => syncSelect(select));
    syncSelect(select);
  }

  function enhanceSelects(root = document) {
    if (root instanceof HTMLSelectElement) enhanceSelect(root);
    for (const select of root.querySelectorAll?.("select:not([multiple])") || []) enhanceSelect(select);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!activeSelect) return;
    const meta = selectMetadata.get(activeSelect);
    if (selectPopover?.contains(event.target) || meta?.trigger.contains(event.target)) return;
    closeSelectPopover();
  }, true);
  document.addEventListener("reset", () => window.setTimeout(() => enhancedSelects.forEach(syncSelect), 0), true);
  window.addEventListener("resize", () => closeSelectPopover());
  document.addEventListener("scroll", (event) => {
    if (activeSelect && !selectPopover?.contains(event.target)) closeSelectPopover();
  }, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const removed = node instanceof HTMLSelectElement ? [node] : [...(node.querySelectorAll?.("select") || [])];
          for (const select of removed) {
            enhancedSelects.delete(select);
            selectMetadata.delete(select);
            if (activeSelect === select) closeSelectPopover();
          }
        }
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) enhanceSelects(node);
        }
        const owner = mutation.target.closest?.("select");
        if (owner) syncSelect(owner);
      } else {
        const select = mutation.target instanceof HTMLSelectElement ? mutation.target : mutation.target.closest?.("select");
        if (select) syncSelect(select);
      }
    }
  });

  function initialize() {
    ensureDialog();
    ensureSelectPopover();
    enhanceSelects();
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden", "label", "selected"],
    });
    window.setInterval(() => enhancedSelects.forEach(syncSelect), 1_000);
  }

  window.OnPeopleUI = {
    alert: (message, options) => requestDialog("alert", message, options),
    confirm: (message, options) => requestDialog("confirm", message, options),
    prompt: (message, options = {}) => requestDialog("prompt", message, options),
    enhanceSelects,
    syncSelect,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
