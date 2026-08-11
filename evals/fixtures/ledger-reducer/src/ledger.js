import { validateAmount } from "./validation.js";

export function summarizeLedger(openingBalance, events) {
  if (!validateAmount(openingBalance)) throw new TypeError("invalid balance");
  return { openingBalance, balance: openingBalance, appliedIds: [] };
}
