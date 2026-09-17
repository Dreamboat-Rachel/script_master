const builtInSubjectStyles = [
  "电影写实",
  "日系动漫",
  "吉卜力治愈手绘",
  "赛博朋克动漫",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripSubjectVisualStyle(value: string, projectStyle = "") {
  const styles = Array.from(new Set([...builtInSubjectStyles, projectStyle.trim()].filter(Boolean)))
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  if (!styles.length) return value.trim();

  const stylePattern = `(?:${styles.join("|")})(?:风格)?`;
  return value
    .replace(new RegExp(`视觉风格\\s*[：:]\\s*${stylePattern}[，,。；;：:]?\\s*`, "gi"), "")
    .replace(new RegExp(`${stylePattern}[，,。；;：:]?\\s*`, "gi"), "")
    .replace(/^[，,。；;：:\s]+/, "")
    .replace(/[，,]{2,}/g, "，")
    .trim();
}
