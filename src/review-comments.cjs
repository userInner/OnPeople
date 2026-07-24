function annotateDiffLines(lines = []) {
  let oldLine = null;
  let newLine = null;
  return lines.map((text, index) => {
    const value = String(text);
    const header = value.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      return { index, text: value, type: "hunk", oldLine: null, newLine: null, commentLine: null, side: null };
    }
    const type = value.startsWith("+") && !value.startsWith("+++") ? "add"
      : value.startsWith("-") && !value.startsWith("---") ? "remove"
        : value.startsWith("diff ") || value.startsWith("# ") || value.startsWith("---") || value.startsWith("+++") ? "header" : "context";
    const result = { index, text: value, type, oldLine: null, newLine: null, commentLine: null, side: null };
    if (oldLine !== null && type === "remove") {
      result.oldLine = oldLine++; result.commentLine = result.oldLine; result.side = "old";
    } else if (newLine !== null && type === "add") {
      result.newLine = newLine++; result.commentLine = result.newLine; result.side = "new";
    } else if (oldLine !== null && newLine !== null && type === "context") {
      result.oldLine = oldLine++; result.newLine = newLine++; result.commentLine = result.newLine; result.side = "new";
    }
    return result;
  });
}

function formatReviewPrompt(comments = []) {
  const normalized = comments.filter((item) => item && item.path && item.body && Number(item.line) > 0);
  if (!normalized.length) throw new Error("没有可提交的行级评论");
  const blocks = normalized.map((item, index) => [
    `${index + 1}. ${item.path}:${item.line} (${item.side === "old" ? "旧版本" : "新版本"})`,
    `代码：${String(item.code || "").trim() || "（无）"}`,
    `评论：${String(item.body).trim()}`,
  ].join("\n"));
  return `请处理以下行级代码审阅意见。逐条检查，实施合理修改，并说明未采纳项的原因。\n\n${blocks.join("\n\n")}`;
}

module.exports = { annotateDiffLines, formatReviewPrompt };
