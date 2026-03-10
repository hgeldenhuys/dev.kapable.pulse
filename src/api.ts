const API_URL = process.env.KAPABLE_API_URL ?? "https://api.kapable.dev";
const API_KEY = process.env.KAPABLE_API_KEY ?? "";
const PROJECT_ID = process.env.KAPABLE_PROJECT_ID ?? "";

const headers = (): Record<string, string> => ({
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "x-project-id": PROJECT_ID,
});

async function apiGet(table: string): Promise<any[]> {
  const res = await fetch(`${API_URL}/v1/data?table=${table}&limit=1000`, {
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`API GET ${table} failed (${res.status}): ${text}`);
    throw new Error(`API GET ${table} failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? [];
}

async function apiPost(table: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_URL}/v1/data?table=${table}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`API POST ${table} failed (${res.status}): ${text}`);
    throw new Error(`API POST ${table} failed: ${res.status}`);
  }
  return res.json();
}

async function apiPatch(table: string, id: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_URL}/v1/data/${id}?table=${table}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`API PATCH ${table}/${id} failed (${res.status}): ${text}`);
    throw new Error(`API PATCH ${table}/${id} failed: ${res.status}`);
  }
  return res.json();
}

export async function getOrCreateBoard(slug: string): Promise<any> {
  const rows = await apiGet("boards");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].slug === slug) {
      return rows[i];
    }
  }
  // Board doesn't exist, create it
  const result = await apiPost("boards", {
    slug,
    title: slug.charAt(0).toUpperCase() + slug.slice(1),
  });
  return result.data ?? result;
}

export async function listIdeas(boardId: string): Promise<any[]> {
  const rows = await apiGet("ideas");
  const filtered: any[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].board_id === boardId) {
      filtered.push(rows[i]);
    }
  }
  // Sort by vote_count DESC, then created_at DESC
  filtered.sort((a, b) => {
    const voteDiff = (b.vote_count ?? 0) - (a.vote_count ?? 0);
    if (voteDiff !== 0) return voteDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return filtered;
}

export async function createIdea(boardId: string, content: string): Promise<any> {
  const result = await apiPost("ideas", {
    board_id: boardId,
    content,
    vote_count: 0,
  });
  return result.data ?? result;
}

export async function upvoteIdea(ideaId: string, visitorId: string): Promise<{ alreadyVoted: boolean }> {
  // Check if vote already exists
  const votes = await apiGet("votes");
  for (let i = 0; i < votes.length; i++) {
    if (votes[i].idea_id === ideaId && votes[i].visitor_id === visitorId) {
      return { alreadyVoted: true };
    }
  }

  // Create the vote
  await apiPost("votes", {
    idea_id: ideaId,
    visitor_id: visitorId,
  });

  // Increment the vote count on the idea
  const ideas = await apiGet("ideas");
  let currentCount = 0;
  for (let i = 0; i < ideas.length; i++) {
    if (ideas[i].id === ideaId) {
      currentCount = ideas[i].vote_count ?? 0;
      break;
    }
  }

  await apiPatch("ideas", ideaId, {
    vote_count: currentCount + 1,
  });

  return { alreadyVoted: false };
}

export function createSSEStream(signal: AbortSignal): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      // Start heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });

      try {
        const res = await fetch(
          `${API_URL}/v1/data?table=ideas&sse=true`,
          {
            headers: headers(),
            signal,
          }
        );

        if (!res.ok || !res.body) {
          console.error(`SSE upstream failed: ${res.status}`);
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            break;
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("SSE stream error:", err);
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });
}
