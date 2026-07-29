(function liveDelegationModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OnPeopleLiveDelegation = api;
})(typeof window !== "undefined" ? window : null, () => {
  const COMMITMENT_PATTERNS = [
    /(?:我|这就|现在|马上)?(?:来|去|帮你|替你)?(?:查|搜|搜索|检索|找找|找一找|核对|确认)(?:一下|一查|看|找看|看看|资料|新闻|信息)?[。！!…]*$/i,
    /(?:稍等|等我|等一下).*(?:查|搜|搜索|找|核对|确认)/i,
    /\b(?:let me|i(?:'ll| will)|i am going to)\s+(?:check|search|look(?:\s+it)?\s+up|verify|find out)\b/i,
  ];
  const COMPLETION_PATTERNS = [
    /(?:已经|刚刚)?(?:找到|查到|搜到|检索到|核对完|确认了|查完|搜完)/i,
    /\b(?:i found|i've found|i have found|the result is|results are)\b/i,
  ];

  function normalizeTranscript(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isDelegationCommitment(value) {
    const text = normalizeTranscript(value);
    if (!text || COMPLETION_PATTERNS.some((pattern) => pattern.test(text))) return false;
    return COMMITMENT_PATTERNS.some((pattern) => pattern.test(text));
  }

  function shouldRecoverDelegation({ assistantText, userText } = {}) {
    const request = normalizeTranscript(userText);
    return request.length >= 2 && isDelegationCommitment(assistantText);
  }

  return {
    isDelegationCommitment,
    normalizeTranscript,
    shouldRecoverDelegation,
  };
});
