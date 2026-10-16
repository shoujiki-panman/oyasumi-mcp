// おやすみ MCP の「覚える係」。子どもの毎日と、毎晩のお話のあらすじを覚えておき、
// 次の夜に続きを語るための材料を組み立てる。お話の文章そのものは呼び出した側の AI が書く。
// 持つのは 名前・年齢・好きなもの・出来事の短い文・あらすじ だけ。写真や居場所は持たない。

export type Language = "ja" | "en" | "ja+en";

export type Child = {
  id: string;
  name: string;
  age?: number;
  likes: string[];
  language: Language;
};

export type DayEvent = { at: number; text: string };

export type Episode = {
  at: number;
  title: string;
  summary: string;
  characters: string[];
  usedEvents: number[]; // DayEvent.at
};

export type Family = {
  children: Child[];
  events: Record<string, DayEvent[]>;
  episodes: Record<string, Episode[]>;
};

export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 50;
const MAX_EPISODES = 30;

export const emptyFamily = (): Family => ({ children: [], events: {}, episodes: {} });

const clip = (s: string, n: number) => s.trim().slice(0, n);

// 名前から変わらない id を作る（同じ名前なら同じ子として上書き）。
export const childId = (name: string) => clip(name, 40).toLowerCase().replace(/\s+/g, "-");

// かな → ローマ字（ヘボン式の簡略版）。「ハナ」「はな」「Hana」を同じ子として見るため（10/13 ChatGPT が「ハナ」を別の子として登録した）。
const KANA: Record<string, string> = {
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o", カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so", タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no", ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo", ヤ: "ya", ユ: "yu", ヨ: "yo",
  ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro", ワ: "wa", ヲ: "o", ン: "n",
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go", ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
  ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do", バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
  パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po",
};
const SMALL: Record<string, string> = { ャ: "ya", ュ: "yu", ョ: "yo" };

export function kanaToRomaji(input: string): string {
  const kata = input.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  let out = "";
  for (let i = 0; i < kata.length; i++) {
    const c = kata[i];
    const next = kata[i + 1];
    if (c === "ッ") continue; // 次の子音を重ねる代わりに落とす（名前の照合には十分）
    if (c === "ー") continue;
    if (next && SMALL[next] && KANA[c]) {
      out += KANA[c].replace(/i$/, "").replace(/^(sh|ch|j)$/, "$1") + (/(sh|ch|j)$/.test(KANA[c].slice(0, -1)) ? SMALL[next].slice(1) : SMALL[next]);
      i++;
      continue;
    }
    out += KANA[c] ?? c;
  }
  return out;
}

// 照合用のキー：かなはローマ字に、敬称（ちゃん・くん・さん）と空白・記号は落とす。
export const nameKey = (name: string) =>
  kanaToRomaji(name.trim().replace(/(ちゃん|くん|さん|チャン|クン)$/u, ""))
    .toLowerCase()
    .replace(/(chan|kun|san)$/, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");

export function findChild(f: Family, name: string): Child | undefined {
  if (!name.trim()) return f.children.length === 1 ? f.children[0] : undefined;
  const key = nameKey(name);
  return f.children.find((c) => c.id === childId(name) || nameKey(c.name) === key);
}

export function upsertChild(
  f: Family,
  input: { name: string; age?: number; likes?: string[]; language?: Language },
): Family {
  const old = findChild(f, input.name);
  const id = old?.id ?? childId(input.name);
  const child: Child = {
    id,
    name: old?.name ?? clip(input.name, 40),
    age: input.age ?? old?.age,
    likes: (input.likes ?? old?.likes ?? []).map((l) => clip(l, 40)).filter(Boolean).slice(0, 10),
    language: input.language ?? old?.language ?? "ja",
  };
  return { ...f, children: [...f.children.filter((c) => c.id !== id), child] };
}

const prune = <T extends { at: number }>(xs: T[], now: number, max: number) =>
  xs.filter((x) => now - x.at < KEEP_MS).sort((a, b) => a.at - b.at).slice(-max);

export function addEvent(f: Family, id: string, text: string, now: number): Family {
  const list = prune([...(f.events[id] ?? []), { at: now, text: clip(text, 200) }], now, MAX_EVENTS);
  return { ...f, events: { ...f.events, [id]: list } };
}

// get_story_context で見せた [1][2][3] の番号を、出来事の時刻に戻す（同じ並びで数え直す）。
export function momentNumbersToAt(f: Family, id: string, numbers: number[]): number[] {
  const events = pendingEvents(f, id);
  return numbers.map((n) => events[n - 1]?.at).filter((at): at is number => at !== undefined);
}

export function addEpisode(
  f: Family,
  id: string,
  ep: { title: string; summary: string; characters?: string[]; usedEvents?: number[] },
  now: number,
): Family {
  const episode: Episode = {
    at: now,
    title: clip(ep.title, 80),
    summary: clip(ep.summary, 600),
    characters: (ep.characters ?? []).map((c) => clip(c, 40)).filter(Boolean).slice(0, 10),
    usedEvents: ep.usedEvents ?? [],
  };
  return { ...f, episodes: { ...f.episodes, [id]: prune([...(f.episodes[id] ?? []), episode], now, MAX_EPISODES) } };
}

const NIGHT_MS = 12 * 60 * 60 * 1000;

// お話の材料を渡した時点で、その夜の回を「下書き」として先に作る。
// AI があらすじを保存し忘れても、使った出来事と回数は残る（10/13 ChatGPT が save_episode を呼ばなかった）。
export function startEpisode(f: Family, id: string, now: number): Family {
  const last = (f.episodes[id] ?? []).at(-1);
  if (last && !last.summary && now - last.at < NIGHT_MS) return f; // 同じ夜の下書きがもうある
  return addEpisode(f, id, { title: "", summary: "", usedEvents: pendingEvents(f, id).map((e) => e.at) }, now);
}

// あらすじを保存する。同じ夜の下書きがあればそれを埋め、なければ新しい回として足す。
export function saveEpisode(
  f: Family,
  id: string,
  ep: { title: string; summary: string; characters?: string[]; usedEvents?: number[] },
  now: number,
): Family {
  const list = f.episodes[id] ?? [];
  const last = list.at(-1);
  if (last && !last.summary && now - last.at < NIGHT_MS) {
    const filled: Episode = {
      ...last,
      title: clip(ep.title, 80),
      summary: clip(ep.summary, 600),
      characters: (ep.characters ?? []).map((c) => clip(c, 40)).filter(Boolean).slice(0, 10),
    };
    return { ...f, episodes: { ...f.episodes, [id]: [...list.slice(0, -1), filled] } };
  }
  return addEpisode(f, id, ep, now);
}

// まだお話に使っていない出来事（新しい順に最大3つ）。
export function pendingEvents(f: Family, id: string): DayEvent[] {
  const used = new Set((f.episodes[id] ?? []).flatMap((e) => e.usedEvents));
  return (f.events[id] ?? []).filter((e) => !used.has(e.at)).slice(-3).reverse();
}

// 何度も出てきた登場人物（出た回数の多い順）。
export function recurringCharacters(f: Family, id: string): string[] {
  const count = new Map<string, number>();
  for (const e of f.episodes[id] ?? []) for (const c of e.characters) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);
}

const LANGUAGE_RULE: Record<Language, string> = {
  ja: "Tell it in Japanese.",
  en: "Tell it in English.",
  "ja+en": "Tell it mainly in Japanese, and weave in a few simple English words or phrases the child can repeat.",
};

// 今夜のお話の材料。AI が読んでそのままお話を書けるように、平文で並べる。
export function storyContext(f: Family, child: Child): string {
  const last = (f.episodes[child.id] ?? []).slice(-3);
  const events = pendingEvents(f, child.id);
  const lines = [
    `Child: ${child.name}${child.age ? `, ${child.age} years old` : ""}. Likes: ${child.likes.join(", ") || "(not set)"}.`,
    last.length
      ? `Story so far (oldest first):\n${last
          .map((e, i) => {
            if (e.summary) return `${i + 1}. "${e.title}" — ${e.summary}`;
            const used = (f.events[child.id] ?? []).filter((x) => e.usedEvents.includes(x.at)).map((x) => x.text);
            return `${i + 1}. (told, but no summary was saved${used.length ? `; it featured: ${used.join(" / ")}` : ""})`;
          })
          .join("\n")}`
      : "This is the first night. Start a new series with the child as the hero.",
    recurringCharacters(f, child.id).length ? `Recurring characters: ${recurringCharacters(f, child.id).join(", ")}.` : "",
    events.length
      ? `Weave these real moments from the child's day into tonight's adventure (as something brave or kind the hero does):\n${events.map((e, i) => `- [${i + 1}] ${e.text}`).join("\n")}`
      : "No new moments today; continue the adventure gently.",
    `How to tell it: ${LANGUAGE_RULE[child.language]} About 3 minutes aloud. Continue from the last episode, keep the recurring characters, end calm and sleepy with a goodnight to ${child.name}. No scary or violent scenes.`,
    "IMPORTANT: right after telling the story, call save_episode with a short title, a 2-3 sentence summary, and the characters — otherwise tomorrow night cannot continue it.",
  ];
  return lines.filter(Boolean).join("\n\n");
}
