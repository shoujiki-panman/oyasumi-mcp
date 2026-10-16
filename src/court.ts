// おうち裁判の「判例集」。家族の小さなけんかを、誰と誰が・何で・どう裁かれたかだけ覚えておき、次の裁判で判事が参照する。
// 持つのは 名前・争点の短い文・判決の要約・罰 だけ。録音や会話の全文は持たない。

export type CaseRecord = {
  id: string;
  at: number;
  plaintiff: string;
  defendant: string;
  issue: string;
  winner: string; // 名前 or "draw"
  verdict: string;
  sentence: string;
};

export type Docket = { cases: CaseRecord[] };

export const emptyDocket = (): Docket => ({ cases: [] });

const MAX_CASES = 200;
const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);
const key = (name: string) => name.trim().replace(/(ちゃん|くん|さん|君)$/u, "").toLowerCase();

export function fileCase(d: Docket, c: Omit<CaseRecord, "id" | "at">, now: number): { docket: Docket; record: CaseRecord } {
  const record: CaseRecord = {
    id: `case-${now.toString(36)}`,
    at: now,
    plaintiff: clip(c.plaintiff, 30),
    defendant: clip(c.defendant, 30),
    issue: clip(c.issue, 80),
    winner: clip(c.winner, 30) || "draw",
    verdict: clip(c.verdict, 400),
    sentence: clip(c.sentence, 120),
  };
  return { docket: { cases: [...d.cases, record].slice(-MAX_CASES) }, record };
}

// その人たちが出てきた過去の裁判（新しい順）
export function precedents(d: Docket, names: string[], limit = 5): CaseRecord[] {
  const keys = names.map(key).filter(Boolean);
  return d.cases
    .filter((c) => keys.some((k) => key(c.plaintiff) === k || key(c.defendant) === k))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

// 判事に渡す平文。勝ち負けの数も添える（「被告は今月2回目ですね」と言えるように）
export function precedentText(d: Docket, names: string[]): string {
  const list = precedents(d, names);
  if (!list.length) return "No precedents: this is their first case.";
  const wins = new Map<string, number>();
  for (const c of precedents(d, names, MAX_CASES)) if (c.winner !== "draw") wins.set(c.winner, (wins.get(c.winner) ?? 0) + 1);
  const lines = list.map((c) => `- ${new Date(c.at).toISOString().slice(0, 10)} ${c.plaintiff} v. ${c.defendant}「${c.issue}」→ 勝ち: ${c.winner} / 罰: ${c.sentence}`);
  const tally = [...wins.entries()].map(([n, w]) => `${n} ${w}勝`).join("、");
  return `Precedents (newest first):\n${lines.join("\n")}${tally ? `\nRecord so far: ${tally}` : ""}`;
}
