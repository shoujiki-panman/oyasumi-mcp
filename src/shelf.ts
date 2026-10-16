// 寝る前の本選び。Kindle の本棚（題名と著者だけ）と、何を勧めて・読んで・やめたかを覚えておき、
// 今夜の1冊を選ぶための材料を組み立てる。選ぶのは呼び出した側の AI。題名を覚えていなくても頼めるようにするのが目的。
// 本文は持たない（Kindle の本文には外から触れない）。題名は本人が渡したもの（Kindle の本棚の一覧）だけ。

export type Book = { title: string; author?: string; reader: string };
export type ReadingStatus = "suggested" | "reading" | "finished" | "stopped";
export type Reading = { at: number; title: string; reader: string; status: ReadingStatus };
export type Shelf = { books: Book[]; log: Reading[] };

export const ME = "me";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOG = 300;
const MAX_BOOKS = 500;

export const emptyShelf = (): Shelf => ({ books: [], log: [] });

// 声で言いやすい短い題名。「(Japanese Edition)」や（新書名）を落とし、副題（空白・コロン・ダッシュの後ろ）を切る。
export function shortTitle(title: string): string {
  const base = title
    .replace(/\s*[(（][^()（）]*[)）]/g, "")
    .replace(/【[^】]*】/g, "")
    .trim();
  const head = base.split(/：|:\s?|――|—|\s-\s/)[0].trim();
  // 空白で副題を切る。ただし英単語どうしの空白（Peter Pan）は切らず、5文字に満たなければ次の語までつなぐ（新訳 赤毛のアン）。
  const words = head.split(/\s+/);
  let cut = words[0];
  for (const w of words.slice(1)) {
    const englishPair = /[A-Za-z]$/.test(cut) && /^[A-Za-z]/.test(w);
    if (!englishPair && [...cut].length >= 5) break;
    cut += ` ${w}`;
  }
  return cut.trim() || base || title.trim();
}

const norm = (s: string) => shortTitle(s).toLowerCase().replace(/[\s・･!！?？、。,.]/g, "");

// 声で言われた題名（一部・言い換えあり）から本を探す。
export function findBook(shelf: Shelf, title: string, reader = ME): Book | undefined {
  const key = norm(title);
  if (!key) return undefined;
  const mine = shelf.books.filter((b) => b.reader === reader);
  return mine.find((b) => norm(b.title) === key) ?? mine.find((b) => norm(b.title).includes(key) || key.includes(norm(b.title)));
}

// 読む人ごとに本棚を入れ替える（ほかの人の本と記録は残す）。
export function setBooks(shelf: Shelf, reader: string, books: { title: string; author?: string }[]): Shelf {
  const seen = new Set<string>();
  const next = books
    .map((b) => ({ title: b.title.trim().slice(0, 200), author: b.author?.trim().slice(0, 100) || undefined, reader }))
    .filter((b) => b.title && !seen.has(b.title) && seen.add(b.title))
    .slice(0, MAX_BOOKS);
  return { ...shelf, books: [...shelf.books.filter((b) => b.reader !== reader), ...next] };
}

export function logReading(shelf: Shelf, reader: string, title: string, status: ReadingStatus, now: number): Shelf {
  const book = findBook(shelf, title, reader);
  const entry: Reading = { at: now, title: book?.title ?? title.trim().slice(0, 200), reader, status };
  return { ...shelf, log: [...shelf.log, entry].slice(-MAX_LOG) };
}

// 本ごとの最新の状態（勧めただけ・読んでいる・読み終えた・やめた）。
export function latestStatus(shelf: Shelf, reader: string): Map<string, Reading> {
  const m = new Map<string, Reading>();
  for (const r of shelf.log) if (r.reader === reader) m.set(r.title, r);
  return m;
}

// 今夜の1冊を選ぶための材料。AI が読んで1冊選べるように平文で並べる。
export function bookContext(shelf: Shelf, reader: string, now: number, mood?: string): string {
  const books = shelf.books.filter((b) => b.reader === reader);
  if (!books.length) return `No books on the shelf for ${reader === ME ? "you" : reader} yet. Ask the user to add their Kindle library (set_bookshelf).`;
  const status = latestStatus(shelf, reader);
  const line = (b: Book) => `- ${shortTitle(b.title)}${b.author ? ` — ${b.author}` : ""}  [full title: ${b.title}]`;
  const by = (s: ReadingStatus, withinDays = Infinity) =>
    books.filter((b) => {
      const r = status.get(b.title);
      return r?.status === s && now - r.at < withinDays * DAY_MS;
    });
  const reading = by("reading");
  const finished = by("finished", 60);
  const stopped = by("stopped", 60);
  const skipped = by("suggested", 3);
  const used = new Set([...reading, ...finished, ...stopped, ...skipped].map((b) => b.title));
  const rest = books.filter((b) => !used.has(b.title));
  const parts = [
    `Tonight's mood: ${mood?.trim() || "(not said)"}`,
    reading.length ? `Reading now (continue one of these unless the mood says otherwise):\n${reading.map(line).join("\n")}` : "",
    skipped.length ? `Suggested in the last 3 nights but not started (avoid):\n${skipped.map(line).join("\n")}` : "",
    finished.length ? `Finished recently (do not suggest):\n${finished.map(line).join("\n")}` : "",
    stopped.length ? `Stopped recently (do not suggest):\n${stopped.map(line).join("\n")}` : "",
    `Other books on the shelf:\n${rest.map(line).join("\n")}`,
    "How to pick: choose ONE book for reading in bed tonight. Calm, not too stimulating; match the mood. " +
      "Say the short title exactly as listed, with one short reason, so the user can ask their Echo: 「Kindleで『short title』を読んで」. " +
      "Note: Alexa cannot read manga or picture books aloud — if you pick one, say it is for reading with your own eyes. " +
      "Then call log_reading with status 'suggested'.",
  ];
  return parts.filter(Boolean).join("\n\n");
}
