export function applyCredit(balance, amount) {
  if (!Number.isInteger(amount)) {
    throw new TypeError("credit amount must be an integer");
  }
  if (amount <= 0) {
    throw new RangeError("credit amount must be positive");
  }
  return { previous: balance, amount, balance: balance + amount };
}
