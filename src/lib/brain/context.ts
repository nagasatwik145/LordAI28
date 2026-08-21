import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { retrieveMemories, type MemoryRecord, type RetrievedMemory } from "@/lib/memory";
import { embed, cosineSimilarity } from "@/lib/memory/embeddings";
import type {
  BrainContextOptions,
  BrainContextResult,
  KnowledgeChunk,
  KnowledgeSource,
  SearchResult,
} from "./types";

export type { BrainContextOptions } from "./types";

const MEMORY_ctx_LIMIT = 8;
const KNOWLEDGE_ctx_LIMIT = 4;
const RECENT_CHAT_LIMIT = 5;
const NOTE_LIMIT = 3;
const TASK_LIMIT = 3;
const TOKEN_BUDGET = 1200;
const CHUNK_TOKENS = 120;

// Contextual data (memories, knowledge, recent chats, notes, tasks) changes
// infrequently but was previously re-fetched from Supabase on EVERY chat
// message as a chain of sequential queries. We cache the raw results per
// (user, project, options) for a short window so rapid follow-up messages skip
// the DB fan-out. The query-specific embedding/scoring still runs each time, so
// relevance is preserved.
const BRAIN_CACHE_TTL_MS = 30_000;

interface BrainCacheEntry {
  ts: number;
  memoryRows: Awaited<ReturnType<typeof fetchMemories>>;
  knowledge: Awaited<ReturnType<typeof fetchKnowledgeChunks>>;
  chats: Awaited<ReturnType<typeof fetchRecentChats>>;
  notes: Awaited<ReturnType<typeof fetchPinnedNotes>>;
  tasks: Awaited<ReturnType<typeof fetchRecentTasks>>;
}

const brainCache = new Map<string, BrainCacheEntry>();

function brainCacheKey(
  userId: string,
  projectId: string | null | undefined,
  includePinnedNotes: boolean,
  includeRecentTasks: boolean,
): string {
  return `${userId}:${projectId ?? ""}:${includePinnedNotes ? 1 : 0}:${includeRecentTasks ? 1 : 0}`;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function truncate(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "...";
}

export async function buildBrainContext(options: BrainContextOptions): Promise<BrainContextResult> {
  const {
    userId,
    projectId,
    query,
    maxMemories = MEMORY_ctx_LIMIT,
    maxKnowledgeChunks = KNOWLEDGE_ctx_LIMIT,
    maxRecentChats = RECENT_CHAT_LIMIT,
    includePinnedNotes = true,
    includeRecentTasks = true,
    tokenBudget = TOKEN_BUDGET,
  } = options;

  const memories: BrainContextResult["memories"] = [];
  const knowledgeChunks: BrainContextResult["knowledgeChunks"] = [];
  const recentChats: BrainContextResult["recentChats"] = [];
  const pinnedNotes: BrainContextResult["pinnedNotes"] = [];
  const recentTasks: BrainContextResult["recentTasks"] = [];

  let usedTokens = 0;

  let memoryRows: Awaited<ReturnType<typeof fetchMemories>> = [];
  let knowledge: Awaited<ReturnType<typeof fetchKnowledgeChunks>> = [];
  let chats: Awaited<ReturnType<typeof fetchRecentChats>> = [];
  let notes: Awaited<ReturnType<typeof fetchPinnedNotes>> = [];
  let tasks: Awaited<ReturnType<typeof fetchRecentTasks>> = [];

  const cacheKey = brainCacheKey(userId, projectId, includePinnedNotes, includeRecentTasks);
  const cached = brainCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BRAIN_CACHE_TTL_MS) {
    memoryRows = cached.memoryRows;
    knowledge = cached.knowledge;
    chats = cached.chats;
    notes = cached.notes;
    tasks = cached.tasks;
  } else {
    // These five lookups are independent, so run them concurrently instead of
    // in a chain. This roughly halves the context-assembly latency.
    const [memResult, knowResult, chatResult, noteResult, taskResult] = await Promise.all([
      fetchMemories(supabase, userId, projectId, maxMemories * 2),
      fetchKnowledgeChunks(supabase, userId, projectId, maxKnowledgeChunks * 2),
      fetchRecentChats(supabase, userId, projectId, maxRecentChats),
      includePinnedNotes
        ? fetchPinnedNotes(supabase, userId, projectId, NOTE_LIMIT)
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchPinnedNotes>>),
      includeRecentTasks
        ? fetchRecentTasks(supabase, userId, projectId, TASK_LIMIT)
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchRecentTasks>>),
    ]);
    memoryRows = memResult;
    knowledge = knowResult;
    chats = chatResult;
    notes = noteResult;
    tasks = taskResult;
    brainCache.set(cacheKey, { ts: Date.now(), memoryRows, knowledge, chats, notes, tasks });
  }

  const memoryRecords: MemoryRecord[] = memoryRows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    content: r.content,
    category: (r.category as MemoryRecord["category"]) ?? "note",
    pinned: r.pinned,
    confidence: r.confidence ?? 1,
    source: (r.source as MemoryRecord["source"]) ?? "manual",
    embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  let retrievedMemories: RetrievedMemory[] = [];
  try {
    retrievedMemories = await retrieveMemories(query, memoryRecords, {
      limit: maxMemories,
      tokenBudget: tokenBudget - usedTokens,
    });
  } catch {
    retrievedMemories = memoryRecords
      .slice(0, maxMemories)
      .map((m) => ({ memory: m, similarity: 0 }));
  }

  for (const retrieved of retrievedMemories) {
    const m = retrieved.memory;
    const snippet = truncate(m.content, 60);
    const tokens = estimateTokens(snippet) + 8;
    if (usedTokens + tokens > tokenBudget) break;
    memories.push({
      id: m.id,
      content: snippet,
      category: m.category,
      importance: m.confidence ?? 0.5,
      similarity: retrieved.similarity,
      pinned: m.pinned,
    });
    usedTokens += tokens;
  }

  const queryVec = await embedQueryVector(query);
  const scoredChunks = queryVec
    ? knowledge
        .map((chunk) => {
          const raw = chunk.embedding;
          const vec = raw ? (JSON.parse(raw) as number[]) : null;
          const sim = vec && vec.length === queryVec.length ? cosineSimilarity(queryVec, vec) : 0;
          return { chunk, similarity: sim };
        })
        .filter((c) => c.similarity > 0.1)
        .sort((a, b) => b.similarity - a.similarity)
    : knowledge.map((chunk) => ({ chunk, similarity: 0 }));

  for (const { chunk } of scoredChunks.slice(0, maxKnowledgeChunks)) {
    const snippet = truncate(chunk.content, CHUNK_TOKENS);
    const tokens = estimateTokens(snippet) + 12;
    if (usedTokens + tokens > tokenBudget) break;
    knowledgeChunks.push({
      id: chunk.id,
      content: snippet,
      summary: chunk.summary ?? undefined,
      heading: chunk.heading ?? undefined,
      sourceName: chunk.sourceName,
      pageNumber: chunk.page_number ?? undefined,
      similarity: scoredChunks.find((c) => c.chunk.id === chunk.id)?.similarity ?? 0,
    });
    usedTokens += tokens;
  }

  for (const chat of chats) {
    const snippet = truncate(chat.lastMessage ?? chat.title ?? "", 80);
    const tokens = estimateTokens(snippet) + 10;
    if (usedTokens + tokens > tokenBudget) break;
    recentChats.push({
      id: chat.id,
      title: chat.title ?? null,
      lastMessage: chat.lastMessage ?? null,
      updatedAt: chat.updated_at ?? new Date().toISOString(),
    });
    usedTokens += tokens;
  }

  if (includePinnedNotes) {
    for (const note of notes) {
      const snippet = truncate(note.content, 80);
      const tokens = estimateTokens(snippet) + 10;
      if (usedTokens + tokens > tokenBudget) break;
      pinnedNotes.push({
        id: note.id,
        title: note.title,
        content: snippet,
        pinned: note.isPinned,
      });
      usedTokens += tokens;
    }
  }

  if (includeRecentTasks) {
    for (const task of tasks) {
      const snippet = truncate(task.title + (task.description ? `: ${task.description}` : ""), 60);
      const tokens = estimateTokens(snippet) + 8;
      if (usedTokens + tokens > tokenBudget) break;
      recentTasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ?? undefined,
      });
      usedTokens += tokens;
    }
  }

  const systemPromptSnippet = buildSystemPromptSnippet({
    projectId,
    memories,
    knowledgeChunks,
    recentChats,
    pinnedNotes,
    recentTasks,
  });

  return {
    systemPromptSnippet,
    memories,
    knowledgeChunks,
    recentChats,
    pinnedNotes,
    recentTasks,
    totalTokens: usedTokens,
  };
}

function buildSystemPromptSnippet(ctx: {
  projectId: string | null | undefined;
  memories: BrainContextResult["memories"];
  knowledgeChunks: BrainContextResult["knowledgeChunks"];
  recentChats: BrainContextResult["recentChats"];
  pinnedNotes: BrainContextResult["pinnedNotes"];
  recentTasks: BrainContextResult["recentTasks"];
}): string {
  const parts: string[] = [];

  if (ctx.projectId) {
    parts.push(
      `PROJECT CONTEXT: The user is working in a project. Reference this project when relevant.`,
    );
  }

  if (ctx.memories.length > 0) {
    const lines = ctx.memories.map((m) => `- ${m.content}`);
    parts.push(`RELEVANT MEMORIES:\n${lines.join("\n")}`);
  }

  if (ctx.knowledgeChunks.length > 0) {
    const lines = ctx.knowledgeChunks.map((k) => {
      const source = k.sourceName ? ` [${k.sourceName}]` : "";
      const heading = k.heading ? `## ${k.heading}\n` : "";
      return `${heading}${k.content}${source}`;
    });
    parts.push(`RELEVANT KNOWLEDGE:\n${lines.join("\n\n")}`);
  }

  if (ctx.recentChats.length > 0) {
    const lines = ctx.recentChats.map(
      (c) => `- ${c.title ?? "Untitled"}: ${c.lastMessage ?? "(no messages)"}`,
    );
    parts.push(`RECENT CONVERSATIONS:\n${lines.join("\n")}`);
  }

  if (ctx.pinnedNotes.length > 0) {
    const lines = ctx.pinnedNotes.map((n) => `- ${n.title}: ${n.content}`);
    parts.push(`PINNED NOTES:\n${lines.join("\n")}`);
  }

  if (ctx.recentTasks.length > 0) {
    const lines = ctx.recentTasks.map((t) => `- [${t.status}] ${t.title} (${t.priority})`);
    parts.push(`RECENT TASKS:\n${lines.join("\n")}`);
  }

  if (parts.length === 0) return "";

  return `ACTIVE CONTEXT:\n\n${parts.join("\n\n")}\n\nUse this context naturally. Do not mention that you are accessing stored context. Do not invent information.`;
}

async function fetchMemories(
  client: ReturnType<typeof supabase.from>,
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    user_id: string;
    content: string;
    category: string;
    pinned: boolean;
    confidence: number;
    source: string;
    embedding: unknown;
    created_at: string;
    updated_at: string;
  }>
> {
  let query = client
    .from("memories")
    .select("*")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.or(`project_id.eq.${projectId},project_id.is.null`);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as Array<{
    id: string;
    user_id: string;
    content: string;
    category: string;
    pinned: boolean;
    confidence: number;
    source: string;
    embedding: unknown;
    created_at: string;
    updated_at: string;
  }>;
}

async function fetchKnowledgeChunks(
  client: ReturnType<typeof supabase.from>,
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    content: string;
    summary: string | null;
    heading: string | null;
    page_number: number | null;
    embedding: string | null;
    knowledge_source_id: string;
    project_id: string | null;
    sourceName?: string;
  }>
> {
  let query = client
    .from("knowledge_chunks")
    .select("*")
    .eq("user_id", userId)
    .order("chunk_index")
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const sourceIds = Array.from(
    new Set((data as Array<{ knowledge_source_id: string }>).map((c) => c.knowledge_source_id)),
  );
  const { data: sources } = await client
    .from("knowledge_sources")
    .select("id, name")
    .in("id", sourceIds);

  const sourceMap = new Map<string, string>();
  for (const s of (sources ?? []) as Array<{ id: string; name: string }>) {
    sourceMap.set(s.id, s.name);
  }

  return (
    data as Array<{
      id: string;
      content: string;
      summary: string | null;
      heading: string | null;
      page_number: number | null;
      embedding: string | null;
      knowledge_source_id: string;
      project_id: string | null;
    }>
  ).map((c) => ({
    ...c,
    sourceName: sourceMap.get(c.knowledge_source_id),
  }));
}

async function fetchRecentChats(
  client: ReturnType<typeof supabase.from>,
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    title: string | null;
    last_message_at: string | null;
    updated_at: string | null;
    lastMessage?: string | null;
  }>
> {
  let query = client
    .from("conversations")
    .select("id, title, last_message_at, updated_at")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return [];

  const typedData = data as Array<{
    id: string;
    title: string | null;
    last_message_at: string | null;
    updated_at: string | null;
  }>;
  const convIds = typedData.map((c) => c.id);
  const { data: lastMessages } = await client
    .from("messages")
    .select("conversation_id, content")
    .in("conversation_id", convIds)
    .eq("role", "user")
    .order("created_at", { ascending: false });

  const lastMsgMap = new Map<string, string>();
  for (const m of (lastMessages ?? []) as Array<{
    conversation_id: string;
    content: string | null;
  }>) {
    if (!lastMsgMap.has(m.conversation_id)) {
      lastMsgMap.set(m.conversation_id, (m.content ?? "").slice(0, 120));
    }
  }

  return typedData.map((c) => ({
    ...c,
    lastMessage: lastMsgMap.get(c.id) ?? null,
  }));
}

async function fetchPinnedNotes(
  client: ReturnType<typeof supabase.from>,
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
  }>
> {
  let query = client
    .from("project_notes")
    .select("id, title, content, is_pinned")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).map(
    (n: { id: string; title: string; content: string; is_pinned: boolean }) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      isPinned: n.is_pinned,
    }),
  );
}

async function fetchRecentTasks(
  client: ReturnType<typeof supabase.from>,
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate?: string;
    description?: string;
  }>
> {
  let query = client
    .from("project_tasks")
    .select("id, title, description, status, priority, due_date")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).map(
    (t: {
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      due_date: string | null;
    }) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? undefined,
      status: t.status,
      priority: t.priority,
      dueDate: t.due_date ?? undefined,
    }),
  );
}

async function embedQueryVector(query: string): Promise<number[] | null> {
  try {
    const result = await embed(query);
    return result.vector;
  } catch {
    return null;
  }
}
