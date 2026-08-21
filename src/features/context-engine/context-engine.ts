import type { BrainContextOptions, BrainContextResult } from "@/lib/brain/types";
import type { RankedContextItem, ContextStrategy } from "@/lib/phase2/types";
import { retrieveMemories, type MemoryRecord, type RetrievedMemory } from "@/lib/memory";
import { embed, cosineSimilarity } from "@/lib/memory/embeddings";

const DEFAULT_TOKEN_BUDGET = 1200;
const MAX_MEMORIES = 12;
const MAX_KNOWLEDGE_CHUNKS = 6;
const MAX_RECENT_CHATS = 8;
const MAX_NOTES = 4;
const MAX_TASKS = 4;

export const CONTEXT_STRATEGIES: Record<string, ContextStrategy> = {
  balanced: {
    id: "balanced",
    name: "Balanced",
    mode: "chat",
    tokenBudget: DEFAULT_TOKEN_BUDGET,
    memoryWeight: 0.25,
    knowledgeWeight: 0.25,
    recencyWeight: 0.2,
    importanceWeight: 0.15,
    similarityWeight: 0.15,
    compressionRatio: 0.5,
  },
  study: {
    id: "study",
    name: "Study",
    mode: "study",
    tokenBudget: 1500,
    memoryWeight: 0.2,
    knowledgeWeight: 0.35,
    recencyWeight: 0.15,
    importanceWeight: 0.1,
    similarityWeight: 0.2,
    compressionRatio: 0.6,
  },
  coding: {
    id: "coding",
    name: "Coding",
    mode: "coding",
    tokenBudget: 1800,
    memoryWeight: 0.15,
    knowledgeWeight: 0.3,
    recencyWeight: 0.1,
    importanceWeight: 0.1,
    similarityWeight: 0.35,
    compressionRatio: 0.4,
  },
  research: {
    id: "research",
    name: "Research",
    mode: "research",
    tokenBudget: 2000,
    memoryWeight: 0.1,
    knowledgeWeight: 0.4,
    recencyWeight: 0.1,
    importanceWeight: 0.1,
    similarityWeight: 0.3,
    compressionRatio: 0.6,
  },
  planning: {
    id: "planning",
    name: "Planning",
    mode: "planning",
    tokenBudget: 1400,
    memoryWeight: 0.2,
    knowledgeWeight: 0.2,
    recencyWeight: 0.25,
    importanceWeight: 0.2,
    similarityWeight: 0.15,
    compressionRatio: 0.5,
  },
  writing: {
    id: "writing",
    name: "Writing",
    mode: "writing",
    tokenBudget: 1600,
    memoryWeight: 0.2,
    knowledgeWeight: 0.25,
    recencyWeight: 0.2,
    importanceWeight: 0.15,
    similarityWeight: 0.2,
    compressionRatio: 0.55,
  },
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncate(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "...";
}

function recencyScore(updatedAt: string): number {
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return 1.0;
  if (diffDays < 7) return 0.8;
  if (diffDays < 30) return 0.5;
  if (diffDays < 90) return 0.2;
  return 0.05;
}

function computeProjectRelevance(
  itemProjectId: string | null | undefined,
  currentProjectId: string | null | undefined,
): number {
  if (!currentProjectId) return 0.5;
  if (!itemProjectId) return 0.2;
  return itemProjectId === currentProjectId ? 1.0 : 0.1;
}

function computeImportanceScore(item: {
  pinned?: boolean;
  confidence?: number;
  priority?: string;
  status?: string;
}): number {
  let score = 0.5;
  if (item.pinned) score += 0.3;
  if (typeof item.confidence === "number") score += item.confidence * 0.2;
  if (item.priority === "urgent") score += 0.2;
  if (item.priority === "high") score += 0.1;
  if (item.status === "done") score -= 0.1;
  return Math.min(1, Math.max(0, score));
}

export async function buildRankedBrainContext(
  options: BrainContextOptions & { strategy?: string },
): Promise<BrainContextResult & { rankedItems: RankedContextItem[]; strategy: ContextStrategy }> {
  const {
    userId,
    projectId,
    query,
    strategy = "balanced",
    maxMemories = MAX_MEMORIES,
    maxKnowledgeChunks = MAX_KNOWLEDGE_CHUNKS,
    maxRecentChats = MAX_RECENT_CHATS,
    includePinnedNotes = true,
    includeRecentTasks = true,
  } = options;

  const ctxStrategy = CONTEXT_STRATEGIES[strategy] ?? CONTEXT_STRATEGIES.balanced;
  const tokenBudget = ctxStrategy.tokenBudget;

  const rankedItems: RankedContextItem[] = [];

  const memoryRows = await fetchMemories(userId, projectId, maxMemories * 2);
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
      tokenBudget,
    });
  } catch {
    retrievedMemories = memoryRecords
      .slice(0, maxMemories)
      .map((m) => ({ memory: m, similarity: 0 }));
  }

  for (const retrieved of retrievedMemories) {
    const m = retrieved.memory;
    const content = truncate(m.content, 60);
    const simScore = retrieved.similarity;
    const recScore = recencyScore(m.updated_at ?? m.created_at);
    const impScore = computeImportanceScore(m);
    const projScore = computeProjectRelevance(m.project_id ?? null, projectId);
    const total =
      simScore * ctxStrategy.similarityWeight +
      recScore * ctxStrategy.recencyWeight +
      impScore * ctxStrategy.importanceWeight +
      projScore * 0.15 +
      0.05;
    rankedItems.push({
      id: m.id,
      type: "memory",
      content,
      score: total,
      recencyScore: recScore,
      importanceScore: impScore,
      similarityScore: simScore,
      projectRelevanceScore: projScore,
      tokens: estimateTokens(content) + 8,
      metadata: { category: m.category, pinned: m.pinned },
    });
  }

  const knowledge = await fetchKnowledgeChunks(userId, projectId, maxKnowledgeChunks * 2);
  const queryVec = query ? await safeEmbed(query) : null;
  const scoredKnowledge = queryVec
    ? knowledge
        .map((chunk) => {
          const vec = chunk.embedding ? (JSON.parse(chunk.embedding) as number[]) : null;
          const sim = vec && vec.length === queryVec.length ? cosineSimilarity(queryVec, vec) : 0;
          return { chunk, similarity: sim };
        })
        .filter((c) => c.similarity > 0.1)
        .sort((a, b) => b.similarity - a.similarity)
    : knowledge.map((chunk) => ({ chunk, similarity: 0 }));

  for (const { chunk } of scoredKnowledge.slice(0, maxKnowledgeChunks)) {
    const content = truncate(chunk.content, 60);
    const simScore = scoredKnowledge.find((c) => c.chunk.id === chunk.id)?.similarity ?? 0;
    const recScore = recencyScore(chunk.createdAt);
    const projScore = computeProjectRelevance(chunk.project_id, projectId);
    const total =
      simScore * ctxStrategy.similarityWeight +
      recScore * ctxStrategy.recencyWeight +
      projScore * 0.2 +
      0.05;
    rankedItems.push({
      id: chunk.id,
      type: "knowledge",
      content,
      score: total,
      recencyScore: recScore,
      importanceScore: 0.5,
      similarityScore: simScore,
      projectRelevanceScore: projScore,
      tokens: estimateTokens(content) + 12,
      metadata: { heading: chunk.heading, sourceName: chunk.sourceName },
    });
  }

  const chats = await fetchRecentChats(userId, projectId, maxRecentChats);
  for (const chat of chats) {
    const content = truncate(chat.title ?? "", 80);
    const recScore = recencyScore(chat.updated_at ?? chat.created_at);
    const projScore = computeProjectRelevance(chat.project_id, projectId);
    const total = recScore * ctxStrategy.recencyWeight + projScore * 0.15 + 0.05;
    rankedItems.push({
      id: chat.id,
      type: "chat",
      content,
      score: total,
      recencyScore: recScore,
      importanceScore: 0.5,
      similarityScore: 0,
      projectRelevanceScore: projScore,
      tokens: estimateTokens(content) + 10,
      metadata: { title: chat.title },
    });
  }

  if (includePinnedNotes) {
    const notes = await fetchPinnedNotes(userId, projectId, MAX_NOTES);
    for (const note of notes) {
      const content = truncate(note.content, 80);
      const recScore = recencyScore(note.updated_at ?? note.created_at);
      const projScore = computeProjectRelevance(note.project_id, projectId);
      const total = recScore * ctxStrategy.recencyWeight + projScore * 0.15 + 0.05;
      rankedItems.push({
        id: note.id,
        type: "note",
        content,
        score: total,
        recencyScore: recScore,
        importanceScore: 0.5,
        similarityScore: 0,
        projectRelevanceScore: projScore,
        tokens: estimateTokens(content) + 10,
        metadata: { title: note.title, pinned: note.isPinned },
      });
    }
  }

  if (includeRecentTasks) {
    const tasks = await fetchRecentTasks(userId, projectId, MAX_TASKS);
    for (const task of tasks) {
      const content = truncate(task.title + (task.description ? `: ${task.description}` : ""), 60);
      const recScore = recencyScore(task.updated_at ?? task.created_at);
      const projScore = computeProjectRelevance(task.project_id, projectId);
      const total = recScore * ctxStrategy.recencyWeight + projScore * 0.15 + 0.05;
      rankedItems.push({
        id: task.id,
        type: "task",
        content,
        score: total,
        recencyScore: recScore,
        importanceScore: computeImportanceScore(task),
        similarityScore: 0,
        projectRelevanceScore: projScore,
        tokens: estimateTokens(content) + 8,
        metadata: { status: task.status, priority: task.priority, dueDate: task.due_date },
      });
    }
  }

  rankedItems.sort((a, b) => b.score - a.score);

  let usedTokens = 0;
  const selectedItems: RankedContextItem[] = [];
  for (const item of rankedItems) {
    if (usedTokens + item.tokens > tokenBudget) break;
    selectedItems.push(item);
    usedTokens += item.tokens;
  }

  const systemPromptSnippet = buildSystemPromptSnippet(selectedItems, projectId);

  return {
    systemPromptSnippet,
    memories: selectedItems
      .filter((i) => i.type === "memory")
      .map((i) => ({
        id: i.id,
        content: i.content,
        category: (i.metadata.category as string) ?? "note",
        importance: i.importanceScore,
        similarity: i.similarityScore,
        pinned: (i.metadata.pinned as boolean) ?? false,
      })),
    knowledgeChunks: selectedItems
      .filter((i) => i.type === "knowledge")
      .map((i) => ({
        id: i.id,
        content: i.content,
        summary: undefined,
        heading: (i.metadata.heading as string) ?? undefined,
        sourceName: (i.metadata.sourceName as string) ?? undefined,
        similarity: i.similarityScore,
      })),
    recentChats: selectedItems
      .filter((i) => i.type === "chat")
      .map((i) => ({
        id: i.id,
        title: (i.metadata.title as string) ?? null,
        lastMessage: i.content,
        updatedAt: new Date().toISOString(),
      })),
    pinnedNotes: selectedItems
      .filter((i) => i.type === "note")
      .map((i) => ({
        id: i.id,
        title: (i.metadata.title as string) ?? "",
        content: i.content,
        pinned: (i.metadata.pinned as boolean) ?? false,
      })),
    recentTasks: selectedItems
      .filter((i) => i.type === "task")
      .map((i) => ({
        id: i.id,
        title: i.content.split(":")[0] ?? i.content,
        status: (i.metadata.status as string) ?? "todo",
        priority: (i.metadata.priority as string) ?? "medium",
        dueDate: (i.metadata.dueDate as string) ?? undefined,
      })),
    totalTokens: usedTokens,
    rankedItems: selectedItems,
    strategy: ctxStrategy,
  };
}

function buildSystemPromptSnippet(
  items: RankedContextItem[],
  projectId: string | null | undefined,
): string {
  const parts: string[] = [];

  if (projectId) {
    parts.push(
      "PROJECT CONTEXT: The user is working in a project. Reference this project when relevant.",
    );
  }

  const memories = items.filter((i) => i.type === "memory");
  if (memories.length > 0) {
    parts.push(`RELEVANT MEMORIES:\n${memories.map((m) => `- ${m.content}`).join("\n")}`);
  }

  const knowledge = items.filter((i) => i.type === "knowledge");
  if (knowledge.length > 0) {
    parts.push(
      `RELEVANT KNOWLEDGE:\n${knowledge
        .map((k) => {
          const heading = k.metadata.heading ? `## ${k.metadata.heading}\n` : "";
          const source = k.metadata.sourceName ? ` [${k.metadata.sourceName}]` : "";
          return `${heading}${k.content}${source}`;
        })
        .join("\n\n")}`,
    );
  }

  const chats = items.filter((i) => i.type === "chat");
  if (chats.length > 0) {
    parts.push(
      `RECENT CONVERSATIONS:\n${chats.map((c) => `- ${c.metadata.title ?? "Untitled"}: ${c.content}`).join("\n")}`,
    );
  }

  const notes = items.filter((i) => i.type === "note");
  if (notes.length > 0) {
    parts.push(
      `PINNED NOTES:\n${notes.map((n) => `- ${n.metadata.title}: ${n.content}`).join("\n")}`,
    );
  }

  const tasks = items.filter((i) => i.type === "task");
  if (tasks.length > 0) {
    parts.push(
      `RECENT TASKS:\n${tasks.map((t) => `- [${t.metadata.status}] ${t.content}`).join("\n")}`,
    );
  }

  if (parts.length === 0) return "";

  return `ACTIVE CONTEXT:\n\n${parts.join("\n\n")}\n\nUse this context naturally. Do not mention that you are accessing stored context. Do not invent information.`;
}

async function fetchMemories(
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
    project_id?: string | null;
  }>
> {
  const { supabase } = await import("@/integrations/supabase/client");
  const db = supabase;
  let query = db
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
  if (error || !data) return [];
  return data as Array<{
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
    project_id?: string | null;
  }>;
}

async function fetchKnowledgeChunks(
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
    createdAt: string;
  }>
> {
  const { supabase } = await import("@/integrations/supabase/client");
  const db = supabase;
  let query = db
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
  const { data: sources } = await db
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
      created_at: string;
    }>
  ).map((c) => ({
    ...c,
    sourceName: sourceMap.get(c.knowledge_source_id),
    createdAt: c.created_at,
  }));
}

async function fetchRecentChats(
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    title: string | null;
    project_id: string | null;
    updated_at: string | null;
    created_at: string;
  }>
> {
  const { supabase } = await import("@/integrations/supabase/client");
  const db = supabase;
  let query = db
    .from("conversations")
    .select("id, title, project_id, updated_at, created_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as Array<{
    id: string;
    title: string | null;
    project_id: string | null;
    updated_at: string | null;
    created_at: string;
  }>;
}

async function fetchPinnedNotes(
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    title: string;
    content: string;
    isPinned: boolean;
    project_id: string | null;
    updated_at: string | null;
    created_at: string;
  }>
> {
  const { supabase } = await import("@/integrations/supabase/client");
  const db = supabase;
  let query = db
    .from("project_notes")
    .select("id, title, content, is_pinned, project_id, updated_at, created_at")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(
    (n: {
      id: string;
      title: string;
      content: string;
      is_pinned: boolean;
      project_id: string | null;
      updated_at: string | null;
      created_at: string;
    }) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      isPinned: n.is_pinned,
      project_id: n.project_id,
      updated_at: n.updated_at,
      created_at: n.created_at,
    }),
  );
}

async function fetchRecentTasks(
  userId: string,
  projectId: string | null | undefined,
  limit: number,
): Promise<
  Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    project_id: string | null;
    updated_at: string | null;
    created_at: string;
  }>
> {
  const { supabase } = await import("@/integrations/supabase/client");
  const db = supabase;
  let query = db
    .from("project_tasks")
    .select(
      "id, title, description, status, priority, due_date, project_id, updated_at, created_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    project_id: string | null;
    updated_at: string | null;
    created_at: string;
  }>;
}

async function safeEmbed(text: string): Promise<number[] | null> {
  try {
    const result = await embed(text);
    return result.vector;
  } catch {
    return null;
  }
}
