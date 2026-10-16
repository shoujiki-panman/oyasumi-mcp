import { describe, expect, it } from "vitest";
import {
  addEpisode,
  addEvent,
  childId,
  emptyFamily,
  findChild,
  KEEP_MS,
  momentNumbersToAt,
  pendingEvents,
  recurringCharacters,
  storyContext,
  upsertChild,
} from "../src/story";

const base = () => upsertChild(emptyFamily(), { name: "Hana", age: 5, likes: ["うさぎ", "電車"], language: "ja+en" });

describe("upsertChild", () => {
  it("正常系: 名前で同じ子を上書きし、渡さなかった項目は前の値を残す", () => {
    const f = upsertChild(base(), { name: "hana", age: 6 });
    expect(f.children).toHaveLength(1);
    expect(f.children[0]).toMatchObject({ id: "hana", age: 6, likes: ["うさぎ", "電車"], language: "ja+en" });
  });
  it("境界: 好きなものは10個まで・空文字は落とす", () => {
    const f = upsertChild(emptyFamily(), { name: "A", likes: ["", ...Array.from({ length: 12 }, (_, i) => `x${i}`)] });
    expect(f.children[0].likes).toHaveLength(10);
  });
});

describe("findChild", () => {
  it("名前で見つける（大文字小文字は問わない）", () => {
    expect(findChild(base(), "HANA")?.name).toBe("Hana");
  });
  it("子が1人で名前が空なら、その子", () => {
    expect(findChild(base(), "")?.name).toBe("Hana");
  });
  it("知らない名前は見つからない", () => {
    expect(findChild(base(), "Taro")).toBeUndefined();
  });
});

describe("出来事とお話", () => {
  it("まだ使っていない出来事を新しい順に最大3つ", () => {
    let f = base();
    for (let i = 1; i <= 5; i++) f = addEvent(f, "hana", `e${i}`, i);
    expect(pendingEvents(f, "hana").map((e) => e.text)).toEqual(["e5", "e4", "e3"]);
  });
  it("お話で使った出来事は次から外れる", () => {
    let f = addEvent(addEvent(base(), "hana", "逆上がりができた", 1), "hana", "ピーマンを食べた", 2);
    f = addEpisode(f, "hana", { title: "t", summary: "s", usedEvents: [1] }, 3);
    expect(pendingEvents(f, "hana").map((e) => e.text)).toEqual(["ピーマンを食べた"]);
  });
  it("30日より古い出来事は消える", () => {
    let f = addEvent(base(), "hana", "old", 0);
    f = addEvent(f, "hana", "new", KEEP_MS + 1);
    expect(f.events.hana.map((e) => e.text)).toEqual(["new"]);
  });
  it("おなじみの登場人物は出た回数の多い順", () => {
    let f = base();
    f = addEpisode(f, "hana", { title: "1", summary: "s", characters: ["うさぎのモモ", "風の精"] }, 1);
    f = addEpisode(f, "hana", { title: "2", summary: "s", characters: ["うさぎのモモ"] }, 2);
    expect(recurringCharacters(f, "hana")).toEqual(["うさぎのモモ", "風の精"]);
  });
});

describe("storyContext", () => {
  it("最初の夜は新しく始めるよう書く", () => {
    const f = base();
    const ctx = storyContext(f, f.children[0]);
    expect(ctx).toContain("This is the first night");
    expect(ctx).toContain("weave in a few simple English words");
  });
  it("前回のあらすじ・登場人物・今日の出来事（番号つき）を入れる", () => {
    let f = addEpisode(base(), "hana", { title: "森の駅", summary: "ハナとモモが森の駅を見つけた。", characters: ["うさぎのモモ"] }, 1);
    f = addEvent(f, "hana", "逆上がりができた", 2);
    const ctx = storyContext(f, f.children[0]);
    expect(ctx).toContain('"森の駅" — ハナとモモが森の駅を見つけた。');
    expect(ctx).toContain("Recurring characters: うさぎのモモ");
    expect(ctx).toContain("- [1] 逆上がりができた");
    expect(ctx).toContain("goodnight to Hana");
  });
  it("id は名前から作る", () => {
    expect(childId("  Hana Chan ")).toBe("hana-chan");
  });
});

describe("momentNumbersToAt", () => {
  it("見せた番号（新しい順の1始まり）を時刻に戻し、範囲外は捨てる", () => {
    let f = base();
    for (let i = 1; i <= 3; i++) f = addEvent(f, "hana", `e${i}`, i * 10);
    expect(momentNumbersToAt(f, "hana", [1, 3, 9])).toEqual([30, 10]);
  });
});

import { kanaToRomaji, nameKey, saveEpisode, startEpisode } from "../src/story";

describe("名前の照合（かな・ローマ字・敬称）", () => {
  it("かなをローマ字に", () => {
    expect(kanaToRomaji("ハナ")).toBe("hana");
    expect(kanaToRomaji("はな")).toBe("hana");
    expect(kanaToRomaji("しょうた")).toBe("shouta");
    expect(kanaToRomaji("リョウ")).toBe("ryou");
  });
  it("敬称と書き方の違いは同じキー", () => {
    expect(nameKey("ハナちゃん")).toBe(nameKey("Hana"));
    expect(nameKey("hana-chan")).toBe("hana");
  });
  it("findChild は「ハナ」で「Hana」を見つけ、set_child は重複を作らない", () => {
    expect(findChild(base(), "ハナ")?.name).toBe("Hana");
    const f = upsertChild(base(), { name: "はなちゃん", age: 6 });
    expect(f.children).toHaveLength(1);
    expect(f.children[0]).toMatchObject({ id: "hana", name: "Hana", age: 6 });
  });
  it("子が2人いて名前が空なら決めない", () => {
    const f = upsertChild(base(), { name: "Taro" });
    expect(findChild(f, "")).toBeUndefined();
  });
});

describe("下書きの回（AI があらすじを保存し忘れても続く）", () => {
  it("材料を渡した時点で、未使用の出来事を下書きに使い済みにする", () => {
    let f = addEvent(base(), "hana", "自転車に乗れた", 1);
    f = startEpisode(f, "hana", 2);
    expect(pendingEvents(f, "hana")).toEqual([]);
    expect(f.episodes.hana).toHaveLength(1);
  });
  it("同じ夜に2回呼んでも下書きは1つ", () => {
    let f = startEpisode(base(), "hana", 1);
    f = startEpisode(f, "hana", 2);
    expect(f.episodes.hana).toHaveLength(1);
  });
  it("保存は同じ夜の下書きを埋める", () => {
    let f = startEpisode(addEvent(base(), "hana", "自転車", 1), "hana", 2);
    f = saveEpisode(f, "hana", { title: "風の道", summary: "s", characters: ["モモ"] }, 3);
    expect(f.episodes.hana).toHaveLength(1);
    expect(f.episodes.hana[0]).toMatchObject({ title: "風の道", usedEvents: [1] });
  });
  it("保存されなかった回は、次の夜の材料に「何を語ったか」として出る", () => {
    let f = startEpisode(addEvent(base(), "hana", "自転車に乗れた", 1), "hana", 2);
    const ctx = storyContext(f, f.children[0]);
    expect(ctx).toContain("no summary was saved; it featured: 自転車に乗れた");
  });
});
