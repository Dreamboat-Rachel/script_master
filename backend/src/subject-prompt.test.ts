import assert from "node:assert/strict";
import test from "node:test";
import { stripSubjectVisualStyle } from "./subject-prompt.js";

test("removes a built-in style from an extracted subject prompt", () => {
  assert.equal(
    stripSubjectVisualStyle("吉卜力治愈手绘风格，角色设定图：十五岁东方玄幻少年"),
    "角色设定图：十五岁东方玄幻少年",
  );
});

test("removes visual-style labels and custom project styles", () => {
  assert.equal(
    stripSubjectVisualStyle("视觉风格：新海诚光影风格，完整人物四视图", "新海诚光影"),
    "完整人物四视图",
  );
});

test("keeps style-free subject details unchanged", () => {
  const prompt = "角色设定图：十五岁东方玄幻少年，青州学宫弟子，身形孱弱";
  assert.equal(stripSubjectVisualStyle(prompt), prompt);
});
