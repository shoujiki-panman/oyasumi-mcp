import { describe, expect, it } from "vitest";
import { bookContext, emptyShelf, findBook, logReading, ME, setBooks, shortTitle } from "../src/shelf";

const DAY = 24 * 60 * 60 * 1000;
const shelf = () =>
  setBooks(emptyShelf(), ME, [
    { title: "ドン・キホーテ (Japanese Edition)", author: "セルバンテス" },
    { title: "走れメロス 友情と信頼をえがいた短編 (Japanese Edition)", author: "太宰治" },
    { title: "吾輩は猫である（新装版） (青空文庫) (Japanese Edition)", author: "夏目漱石" },
    { title: "宮沢賢治全集: 全10巻: Complete Works 宮沢賢治 (Kenji) (Japanese Edition)" },
  ]);

describe("shortTitle", () => {
  it("版の表記と副題を落とす", () => {
    expect(shortTitle("ドン・キホーテ (Japanese Edition)")).toBe("ドン・キホーテ");
    expect(shortTitle("走れメロス 友情と信頼をえがいた短編 (Japanese Edition)")).toBe("走れメロス");
    expect(shortTitle("吾輩は猫である（新装版） (青空文庫) (Japanese Edition)")).toBe("吾輩は猫である");
    expect(shortTitle("宮沢賢治全集: 全10巻: Complete Works")).toBe("宮沢賢治全集");
    expect(shortTitle("Peter Pan ピーター・パンの冒険 (Japanese Edition)")).toBe("Peter Pan");
    expect(shortTitle("新訳 赤毛のアン (Japanese Edition)")).toBe("新訳 赤毛のアン");
    expect(shortTitle("注文の多い料理店――宮沢賢治童話集 (Japanese Edition)")).toBe("注文の多い料理店");
  });
});

describe("findBook", () => {
  it("短い題名・一部・空白違いでも見つける", () => {
    expect(findBook(shelf(), "ドン キホーテ")?.author).toBe("セルバンテス");
    expect(findBook(shelf(), "吾輩は猫である")?.author).toBe("夏目漱石");
    expect(findBook(shelf(), "メロス")?.author).toBe("太宰治");
  });
  it("ほかの人の本棚は探さない・空は見つからない", () => {
    expect(findBook(shelf(), "ドン・キホーテ", "hana")).toBeUndefined();
    expect(findBook(shelf(), "")).toBeUndefined();
  });
});

describe("setBooks", () => {
  it("同じ人の本棚は入れ替え、ほかの人の本は残す・重複は1冊に", () => {
    let s = setBooks(shelf(), "hana", [{ title: "ぐりとぐら" }, { title: "ぐりとぐら" }]);
    s = setBooks(s, ME, [{ title: "羅生門" }]);
    expect(s.books.map((b) => b.title)).toEqual(["ぐりとぐら", "羅生門"]);
  });
});

describe("bookContext", () => {
  it("読んでいる本を先に、3晩以内に勧めて読まなかった本と読み終えた本は外す", () => {
    let s = logReading(shelf(), ME, "吾輩は猫である", "reading", 1 * DAY);
    s = logReading(s, ME, "ドン・キホーテ", "suggested", 9 * DAY);
    s = logReading(s, ME, "メロス", "finished", 9 * DAY);
    const ctx = bookContext(s, ME, 10 * DAY, "疲れた");
    expect(ctx).toContain("Tonight's mood: 疲れた");
    expect(ctx).toMatch(/Reading now[^\n]*\n- 吾輩は猫である/);
    expect(ctx).toMatch(/Suggested in the last 3 nights[^\n]*\n- ドン・キホーテ/);
    expect(ctx).toMatch(/Finished recently[^\n]*\n- 走れメロス/);
    expect(ctx.split("Other books on the shelf:")[1]).not.toContain("ドン・キホーテ");
  });
  it("勧めてから3晩たてば、また候補に戻る", () => {
    const s = logReading(shelf(), ME, "ドン・キホーテ", "suggested", 0);
    expect(bookContext(s, ME, 4 * DAY).split("Other books on the shelf:")[1]).toContain("ドン・キホーテ");
  });
  it("本棚が空なら入れ方を案内する", () => {
    expect(bookContext(emptyShelf(), ME, 0)).toContain("set_bookshelf");
  });
});
