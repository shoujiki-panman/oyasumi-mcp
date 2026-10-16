import { describe, expect, it } from "vitest";
import { emptyDocket, fileCase, precedents, precedentText } from "../src/court";

const base = { verdict: "v", sentence: "変顔10秒" };

describe("判例集", () => {
  it("記録した裁判を、その人の名前で新しい順に引ける（敬称の違いは同じ人）", () => {
    let d = emptyDocket();
    d = fileCase(d, { plaintiff: "ハナ", defendant: "タロウ", issue: "レゴ", winner: "ハナ", ...base }, 1).docket;
    d = fileCase(d, { plaintiff: "タロウくん", defendant: "ハナちゃん", issue: "ゲーム", winner: "draw", ...base }, 2).docket;
    d = fileCase(d, { plaintiff: "ジロウ", defendant: "サブロウ", issue: "おやつ", winner: "ジロウ", ...base }, 3).docket;
    expect(precedents(d, ["タロウ"]).map((c) => c.issue)).toEqual(["ゲーム", "レゴ"]);
  });
  it("初めての人は「判例なし」", () => {
    expect(precedentText(emptyDocket(), ["ハナ"])).toContain("first case");
  });
  it("判例の文に勝ち数を添える（引き分けは数えない）", () => {
    let d = emptyDocket();
    d = fileCase(d, { plaintiff: "ハナ", defendant: "タロウ", issue: "レゴ", winner: "ハナ", ...base }, 1).docket;
    d = fileCase(d, { plaintiff: "ハナ", defendant: "タロウ", issue: "テレビ", winner: "ハナ", ...base }, 2).docket;
    d = fileCase(d, { plaintiff: "タロウ", defendant: "ハナ", issue: "おやつ", winner: "draw", ...base }, 3).docket;
    const t = precedentText(d, ["ハナ", "タロウ"]);
    expect(t).toContain("ハナ 2勝");
    expect(t.indexOf("おやつ")).toBeLessThan(t.indexOf("レゴ"));
  });
  it("勝ちが空なら引き分け・長い文は切る", () => {
    const { record } = fileCase(emptyDocket(), { plaintiff: "A", defendant: "B", issue: "x".repeat(200), winner: "", verdict: "v", sentence: "s" }, 5);
    expect(record.winner).toBe("draw");
    expect(record.issue).toHaveLength(80);
  });
});
