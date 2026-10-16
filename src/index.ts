// おやすみ MCP サーバー：その子の一日を覚えていて、毎晩「続きもの」のお話を語るための材料を渡す。
// お話の文章は呼び出した側の AI（Alexa+ / ChatGPT）が書く。このサーバーは「覚える係」。
//   /mcp            … MCP（Streamable HTTP）。OAuth 2.1（ChatGPT・Alexa+ はこちら。DCR と CIMD に対応）
//   /authorize      … OAuth の同意画面（合言葉で家族だけが許可できる）
//   /internal-mcp   … 同じ MCP を固定の合言葉（Bearer MCP_TOKEN）で。Echo の橋渡しスキルが Service Binding で使う
import { createMcpHandler } from "agents/mcp/server";
import { AuthorizationError, CimdFetchError, OAuthProvider, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { emptyDocket, fileCase, precedentText, type Docket } from "./court";
import { bookContext, emptyShelf, findBook, logReading, ME, setBooks, type Shelf } from "./shelf";
import { addEvent, emptyFamily, type Family, findChild, momentNumbersToAt, saveEpisode, startEpisode, storyContext, upsertChild } from "./story";

type Env = {
  STORIES: KVNamespace;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_TOKEN: string;
  LOGIN_PASSPHRASE: string;
};

// いまは1家族だけ（合言葉を知っている家族）。複数家族にするときは OAuth の userId ごとに分ける。
const FAMILY_KEY = "family:default";
const load = async (env: Env): Promise<Family> => (await env.STORIES.get<Family>(FAMILY_KEY, "json")) ?? emptyFamily();
const save = (env: Env, f: Family) => env.STORIES.put(FAMILY_KEY, JSON.stringify(f));
const DOCKET_KEY = "docket:default";
const loadDocket = async (env: Env): Promise<Docket> => (await env.STORIES.get<Docket>(DOCKET_KEY, "json")) ?? emptyDocket();
const SHELF_KEY = "shelf:default";
const loadShelf = async (env: Env): Promise<Shelf> => (await env.STORIES.get<Shelf>(SHELF_KEY, "json")) ?? emptyShelf();
const saveShelf = (env: Env, s: Shelf) => env.STORIES.put(SHELF_KEY, JSON.stringify(s));
const readerOf = (who?: string) => (!who || /^(me|自分|私|俺|僕)$/i.test(who.trim()) ? ME : who.trim());
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// 知らない名前のときは、登録済みの子の名前を返す（AI が別の書き方で新しい子を作らないように）。
const unknownChild = (f: Family, name?: string) =>
  f.children.length
    ? `I don't know "${name ?? ""}". Registered children: ${f.children.map((c) => c.name).join(", ")}. Use one of these names (spelling in kana or romaji is fine).`
    : "No child is registered yet. Call set_child first.";

const childName = z.string().describe("The child's first name, e.g. 'Hana'. May be omitted when there is only one child.");

function createServer(env: Env) {
  const server = new McpServer({ name: "oyasumi", version: "0.3.0" });

  server.registerTool(
    "set_child",
    {
      description:
        "Register or update a child for bedtime stories: name, age, things they love, and the story language. " +
        "If the child may already be registered (e.g. a different spelling like ハナ / Hana), it updates that child instead of adding a new one.",
      annotations: { title: "Set up a child", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        name: z.string().min(1).describe("The child's first name"),
        age: z.number().int().min(0).max(15).optional(),
        likes: z.array(z.string()).optional().describe("Things the child loves, e.g. ['rabbits', 'trains']"),
        language: z.enum(["ja", "en", "ja+en"]).optional().describe("ja = Japanese, en = English, ja+en = Japanese with a few English words"),
      },
    },
    async ({ name, age, likes, language }) => {
      const f = upsertChild(await load(env), { name, age, likes, language });
      await save(env, f);
      const c = findChild(f, name)!;
      return text(`Saved ${c.name}${c.age ? ` (${c.age})` : ""}. Likes: ${c.likes.join(", ") || "-"}. Language: ${c.language}.`);
    },
  );

  server.registerTool(
    "remember_today",
    {
      description:
        "Remember one moment from the child's day so tonight's bedtime story can include it. " +
        "Use when a parent says things like 'she finally did a pull-over on the bar today' or 'he ate his peppers'. One moment per call.",
      annotations: { title: "Remember a moment", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: { child: childName.optional(), moment: z.string().min(1).describe("What happened, in the parent's words") },
    },
    async ({ child, moment }) => {
      const f = await load(env);
      const c = findChild(f, child ?? "");
      if (!c) return text(unknownChild(f, child));
      await save(env, addEvent(f, c.id, moment, Date.now()));
      return text(`Remembered for ${c.name}'s story tonight: "${moment.trim()}"`);
    },
  );

  server.registerTool(
    "get_story_context",
    {
      description:
        "ALWAYS call this first whenever someone asks for a bedtime story, even if you already know today's moments from the chat. " +
        "It returns the story so far (so tonight continues last night's episode), the recurring characters, the child's profile, " +
        "and today's moments to weave in. Then tell the story yourself, and call save_episode.",
      annotations: { title: "Get tonight's story", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { child: childName.optional() },
    },
    async ({ child }) => {
      const f = await load(env);
      const c = findChild(f, child ?? "");
      if (!c) return text(unknownChild(f, child));
      const ctx = storyContext(f, c);
      await save(env, startEpisode(f, c.id, Date.now()));
      return text(ctx);
    },
  );

  server.registerTool(
    "preview_story_context",
    {
      description:
        "Read tonight's story material without starting tonight's episode. For preparing a story in advance (e.g. before bedtime). " +
        "When actually telling the story, use get_story_context instead.",
      annotations: { title: "Preview tonight's story", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { child: childName.optional() },
    },
    async ({ child }) => {
      const f = await load(env);
      const c = findChild(f, child ?? "");
      if (!c) return text(unknownChild(f, child));
      return text(storyContext(f, c));
    },
  );

  server.registerTool(
    "save_episode",
    {
      description:
        "Save what tonight's story was about, so tomorrow night can continue it. Call right after telling the story. " +
        "The story must have been based on get_story_context (call that first).",
      annotations: { title: "Save tonight's story", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        child: childName.optional(),
        title: z.string().min(1),
        summary: z.string().min(1).describe("2-3 sentences: what happened, where it ended"),
        characters: z.array(z.string()).optional().describe("Named characters who appeared"),
        usedMoments: z.array(z.number()).optional().describe("The [numbers] of today's moments that were used"),
      },
    },
    async ({ child, title, summary, characters, usedMoments }) => {
      const f = await load(env);
      const c = findChild(f, child ?? "");
      if (!c) return text(unknownChild(f, child));
      await save(env, saveEpisode(f, c.id, { title, summary, characters, usedEvents: momentNumbersToAt(f, c.id, usedMoments ?? []) }, Date.now()));
      return text(`Saved tonight's episode "${title}" for ${c.name}. Tomorrow's story will continue from here.`);
    },
  );

  // ── おうち裁判の判例集 ──
  server.registerTool(
    "get_precedents",
    {
      description:
        "Before a family mock trial (おうち裁判) reaches its verdict, get past cases involving these people: who sued whom, over what, " +
        "who won and the playful sentence. The judge can then say things like 'the defendant was found guilty of snack theft last week'.",
      annotations: { title: "Past cases", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { names: z.array(z.string().min(1)).min(1).max(6).describe("The children's names in this case") },
    },
    async ({ names }) => text(precedentText(await loadDocket(env), names)),
  );

  server.registerTool(
    "file_case",
    {
      description: "After the verdict of a family mock trial, record the case so future trials can refer to it. Keep it short; no full transcripts.",
      annotations: { title: "Record the case", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        plaintiff: z.string().min(1),
        defendant: z.string().min(1),
        issue: z.string().min(1).describe("What the fight was about, ~10 words"),
        winner: z.string().describe("The winner's name, or 'draw'"),
        verdict: z.string().min(1).describe("The verdict in 1-3 sentences"),
        sentence: z.string().describe("The playful sentence / make-up sign / house promise"),
      },
    },
    async (c) => {
      const { docket, record } = fileCase(await loadDocket(env), c, Date.now());
      await env.STORIES.put(DOCKET_KEY, JSON.stringify(docket));
      return text(`Filed ${record.id}: ${record.plaintiff} v. ${record.defendant} (${record.issue}) → ${record.winner}.`);
    },
  );

  // ── 寝る前の本選び（Kindle の本棚から今夜の1冊） ──
  const reader = z.string().optional().describe("Whose shelf: omit for the user themself, or a child's name");

  server.registerTool(
    "set_bookshelf",
    {
      description:
        "Save the user's Kindle library (titles and authors only) so bedtime book picks can come from it. Replaces that reader's list. " +
        "The user pastes or lists their books; never log in to Amazon on their behalf.",
      annotations: { title: "Save my bookshelf", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        reader,
        books: z.array(z.object({ title: z.string().min(1), author: z.string().optional() })).min(1).max(500),
      },
    },
    async ({ reader: who, books }) => {
      const r = readerOf(who);
      const s = setBooks(await loadShelf(env), r, books);
      await saveShelf(env, s);
      return text(`Saved ${s.books.filter((b) => b.reader === r).length} books on ${r === ME ? "your" : `${r}'s`} shelf.`);
    },
  );

  server.registerTool(
    "get_book_choices",
    {
      description:
        "ALWAYS call this when someone asks what to read tonight / before bed, or can't remember a book's title. " +
        "Returns their Kindle shelf with what they are reading, finished, stopped, or were recently suggested. " +
        "Pick ONE book from it, say its short title and one reason, then call log_reading with status 'suggested'.",
      annotations: { title: "What to read tonight", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { reader, mood: z.string().optional().describe("How they feel tonight, e.g. 'tired', 'want something light'") },
    },
    async ({ reader: who, mood }) => text(bookContext(await loadShelf(env), readerOf(who), Date.now(), mood)),
  );

  server.registerTool(
    "log_reading",
    {
      description:
        "Remember what happened with a book: 'suggested' (you just recommended it), 'reading' (they started or are continuing), " +
        "'finished', or 'stopped' (gave up). Tomorrow's pick uses this.",
      annotations: { title: "Log a book", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: { reader, title: z.string().min(1).describe("The book title (short title is fine)"), status: z.enum(["suggested", "reading", "finished", "stopped"]) },
    },
    async ({ reader: who, title, status }) => {
      const r = readerOf(who);
      const s0 = await loadShelf(env);
      const book = findBook(s0, title, r);
      await saveShelf(env, logReading(s0, r, title, status, Date.now()));
      return text(book ? `Noted: "${book.title}" — ${status}.` : `Noted "${title}" — ${status} (not found on the shelf; saved as said).`);
    },
  );

  return server;
}

const ORIGIN = "https://oyasumi-mcp.panman.workers.dev";
const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function consentPage(d: ConsentDescription, handle: string, wrong = false): string {
  const name = escape(d.clientName);
  const origin = d.clientDomain ? `発行元: <strong>${escape(d.clientDomain)}</strong>` : "このアプリは自分で名乗っています（名前は確かめられていません）";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>おやすみ MCP</title><body style="font-family:system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.6">
<h1 style="font-size:1.3rem">${name} に、お話の記録の読み書きを許可しますか？</h1>
<p>${origin}<br>許可の結果は <strong>${escape(d.redirectHost)}</strong> に送られます。</p>
${d.redirectIsLoopback ? "<p><strong>このパソコンのアプリに送られます。</strong>自分で今ログインを始めたときだけ続けてください。</p>" : ""}
${wrong ? '<p style="color:#b00">合言葉が違います。</p>' : ""}
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<label>合言葉 <input name="passphrase" type="password" autocomplete="current-password" required style="width:100%;font-size:1rem;padding:.4rem"></label>
<p><button name="decision" value="approve" style="font-size:1rem;padding:.4rem 1rem">許可する</button>
<button name="decision" value="deny" style="font-size:1rem;padding:.4rem 1rem">やめる</button></p></form>`;
}

const html = (body: string, headers?: Headers) => {
  const h = headers ?? new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: h });
};

async function handleAuthorize(req: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (req.method === "GET") {
      const request = await oauth.parseAuthRequest(req);
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      return html(consentPage(details, consent.handle), consent.headers);
    }
    const form = await req.formData();
    const handle = String(form.get("handle"));
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(req, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (!env.LOGIN_PASSPHRASE || form.get("passphrase") !== env.LOGIN_PASSPHRASE) {
      return new Response("合言葉が違います。前の画面に戻ってやり直してください。", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    const approved = await oauth.approveConsent(req, handle, { scope: ["stories"] });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: "family",
      metadata: {},
      scope: approved.request.scope,
      props: { userId: "family" },
    });
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "このアプリを確かめられませんでした。";
      return new Response(escape(String(message)), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }
}

const mcp = (env: Env, ctx: ExecutionContext, req: Request, route: string) =>
  createMcpHandler(() => createServer(env), { route })(req, env, ctx);

const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname.startsWith("/internal-mcp")) {
      if (!env.MCP_TOKEN || request.headers.get("authorization") !== `Bearer ${env.MCP_TOKEN}`) {
        return new Response("unauthorized", { status: 401 });
      }
      return mcp(env, ctx, request, "/internal-mcp");
    }
    return new Response("oyasumi MCP server");
  },
};

export default new OAuthProvider<Env>({
  // ChatGPT との引き換え（トークン）でつまずいたときに理由を残す
  onError: (e: unknown) => console.log(`oauth error: ${JSON.stringify(e).slice(0, 400)}`),
  apiRoute: "/mcp",
  apiHandler: { fetch: (req: Request, env: Env, ctx: ExecutionContext) => mcp(env, ctx, req, "/mcp") },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["stories"],
  requiredScopes: ["stories"],
  resourceMetadata: { resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] },
  clientIdMetadataDocumentEnabled: true,
});
