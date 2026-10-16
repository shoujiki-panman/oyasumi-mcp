# oyasumi-mcp — the family memory behind おうち裁判

An MCP server (spec 2025-11-25, Streamable HTTP) on Cloudflare Workers that remembers a
family across sessions, so an Alexa+-style assistant can pick up where it left off.
It is the "memory" for [おうち裁判 (Ouchi Court)](https://github.com/shoujiki-panman/ouchi-court):
every verdict is filed as a precedent, and the next trial can cite it.

The server only remembers. The calling AI (Alexa+, ChatGPT, or the Ouchi Court worker)
writes the speech.

## Tools

| Tool | What it does |
| --- | --- |
| `get_precedents` | Past cases involving these names (issue, outcome, penalty) for the judge to cite |
| `file_case` | Save a finished trial as a short precedent: names, issue, outcome summary only |
| `set_child` / `remember_today` | Who the child is and what happened today |
| `get_story_context` / `save_episode` | Material for a bedtime story that continues night after night |
| `set_bookshelf` / `get_book_choices` / `log_reading` | Pick tonight's book from the family's own shelf (titles and authors only) |

## Endpoints

- `/mcp` — MCP over Streamable HTTP with OAuth 2.1 (dynamic client registration and client ID metadata documents)
- `/authorize` — consent screen; only someone with the family passphrase can approve
- `/internal-mcp` — the same MCP behind a fixed bearer token, used through a Cloudflare service binding

## Run it

```bash
npm install
npm test            # vitest
npx wrangler deploy
```

Secrets: `MCP_TOKEN` (internal bearer) and `LOGIN_PASSPHRASE` (OAuth consent).
KV namespaces are configured in `wrangler.jsonc`.

## Privacy

Stores only what the tools above describe, per family. No audio, no book text,
no full transcripts.

License: MIT
