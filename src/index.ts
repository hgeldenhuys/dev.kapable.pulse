import { getOrCreateBoard, listIdeas, createIdea, upvoteIdea, createSSEStream } from "./api";
import { resolve } from "path";

const PORT = parseInt(process.env.PORT ?? "3030");
const BOARD_SLUG = process.env.BOARD_SLUG ?? "default";

// Load the HTML at startup
const htmlPath = resolve(import.meta.dir, "app.html");
const APP_HTML = await Bun.file(htmlPath).text();

// Initialize the board
let boardId: string | null = null;

async function ensureBoard(): Promise<string> {
  if (!boardId) {
    const board = await getOrCreateBoard(BOARD_SLUG);
    boardId = board.id;
    console.log(`Board ready: "${BOARD_SLUG}" (${boardId})`);
  }
  return boardId!;
}

// Eagerly initialize
ensureBoard().catch((err) => {
  console.error("Failed to initialize board:", err);
});

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    // GET /api/ideas — list all ideas for this board
    if (url.pathname === "/api/ideas" && req.method === "GET") {
      try {
        const bid = await ensureBoard();
        const ideas = await listIdeas(bid);
        return Response.json(ideas);
      } catch (err: any) {
        console.error("GET /api/ideas error:", err);
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // POST /api/ideas — create a new idea
    if (url.pathname === "/api/ideas" && req.method === "POST") {
      try {
        const body = await req.json();
        const content = (body.content ?? "").trim();
        if (!content) {
          return Response.json({ error: "Content is required" }, { status: 400 });
        }
        if (content.length > 500) {
          return Response.json({ error: "Content too long (max 500 chars)" }, { status: 400 });
        }
        const bid = await ensureBoard();
        const idea = await createIdea(bid, content);
        return Response.json(idea);
      } catch (err: any) {
        console.error("POST /api/ideas error:", err);
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // POST /api/upvote — upvote an idea
    if (url.pathname === "/api/upvote" && req.method === "POST") {
      try {
        const body = await req.json();
        const { ideaId, visitorId } = body;
        if (!ideaId || !visitorId) {
          return Response.json({ error: "ideaId and visitorId required" }, { status: 400 });
        }
        const result = await upvoteIdea(ideaId, visitorId);
        return Response.json(result);
      } catch (err: any) {
        console.error("POST /api/upvote error:", err);
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // GET /api/sse — server-sent events stream
    if (url.pathname === "/api/sse") {
      const controller = new AbortController();
      req.signal.addEventListener("abort", () => controller.abort());

      const stream = createSSEStream(controller.signal);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Serve the single-page app for everything else
    return new Response(APP_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`Pulse running at http://localhost:${PORT}`);
