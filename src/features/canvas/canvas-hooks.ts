import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { CanvasArtifact, ArtifactVersion, ArtifactType } from "@/lib/phase2/types";
import type { Database } from "@/integrations/supabase/types";

const db = supabase;
const ARTIFACTS_TABLE = "canvas_artifacts";
const VERSIONS_TABLE = "canvas_artifact_versions";

export async function fetchArtifact(id: string): Promise<CanvasArtifact | null> {
  const { data, error } = await db.from(ARTIFACTS_TABLE).select("*").eq("id", id).single();

  if (error || !data) return null;
  return mapArtifact(data);
}

export async function fetchProjectArtifacts(
  projectId: string | null,
  userId: string,
): Promise<CanvasArtifact[]> {
  let query = db
    .from(ARTIFACTS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false });

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(mapArtifact);
}

export async function createArtifact(input: {
  userId: string;
  projectId?: string | null;
  title: string;
  type: ArtifactType;
  content: string;
  language?: string;
  tags?: string[];
}): Promise<CanvasArtifact> {
  const { data, error } = await db
    .from(ARTIFACTS_TABLE)
    .insert({
      user_id: input.userId,
      project_id: input.projectId ?? null,
      title: input.title,
      type: input.type,
      content: input.content,
      language: input.language ?? null,
      tags: input.tags ?? [],
      version: 1,
      parent_version_id: null,
      is_archived: false,
      is_shared: false,
      share_token: null,
      metadata: {},
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create artifact");
  const artifact = mapArtifact(data);

  await db.from(VERSIONS_TABLE).insert({
    artifact_id: artifact.id,
    content: artifact.content,
    metadata: { title: artifact.title, type: artifact.type },
    created_by: input.userId,
  });

  return artifact;
}

export async function updateArtifact(
  id: string,
  userId: string,
  updates: Partial<
    Pick<
      CanvasArtifact,
      "title" | "content" | "type" | "language" | "tags" | "isArchived" | "isShared"
    >
  >,
): Promise<CanvasArtifact> {
  const { data: existing } = await db
    .from(ARTIFACTS_TABLE)
    .select("version, content")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!existing) throw new Error("Artifact not found");

  const patch: Database["public"]["Tables"]["canvas_artifacts"]["Update"] = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.content !== undefined) patch.content = updates.content;
  if (updates.type !== undefined) patch.type = updates.type;
  if (updates.language !== undefined) patch.language = updates.language;
  if (updates.tags !== undefined) patch.tags = updates.tags;
  if (updates.isArchived !== undefined) patch.is_archived = updates.isArchived;
  if (updates.isShared !== undefined) patch.is_shared = updates.isShared;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from(ARTIFACTS_TABLE)
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to update artifact");

  const updated = mapArtifact(data);

  if (updates.content !== undefined && existing.content !== updates.content) {
    await db.from(VERSIONS_TABLE).insert({
      artifact_id: id,
      content: updates.content,
      metadata: { title: updated.title, type: updated.type, version: updated.version },
      created_by: userId,
    });
  }

  return updated;
}

export async function deleteArtifact(id: string, userId: string): Promise<void> {
  const { error } = await db.from(ARTIFACTS_TABLE).delete().eq("id", id).eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function fetchVersions(artifactId: string): Promise<ArtifactVersion[]> {
  const { data, error } = await db
    .from(VERSIONS_TABLE)
    .select("*")
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map((v) => ({
    id: v.id,
    artifactId: v.artifact_id,
    content: v.content,
    metadata: v.metadata as Record<string, unknown>,
    createdAt: v.created_at,
    createdBy: v.created_by,
  }));
}

function mapArtifact(row: Record<string, unknown>): CanvasArtifact {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    projectId: row.project_id as string | null,
    title: row.title as string,
    type: row.type as ArtifactType,
    content: (row.content as string) ?? "",
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    version: (row.version as number) ?? 1,
    parentVersionId: row.parent_version_id as string | null,
    isArchived: row.is_archived as boolean,
    isShared: row.is_shared as boolean,
    shareToken: row.share_token as string | null,
    language: row.language as string | undefined,
    tags: (row.tags as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function useCanvas() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["canvas", "artifacts"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Unauthorized");
      return fetchProjectArtifacts(null, user.id);
    },
  });

  const projectQuery = useQuery({
    queryKey: ["canvas", "artifacts", "project"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Unauthorized");
      return fetchProjectArtifacts(null, user.id);
    },
  });

  const createMutation = useMutation({
    mutationFn: createArtifact,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas"] });
      toast.success("Artifact created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      userId,
      updates,
    }: {
      id: string;
      userId: string;
      updates: Partial<Pick<CanvasArtifact, "title" | "content" | "type" | "language" | "tags">>;
    }) => updateArtifact(id, userId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => deleteArtifact(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas"] });
      toast.success("Artifact deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    artifacts: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    createArtifact: createMutation.mutateAsync,
    updateArtifact: updateMutation.mutateAsync,
    deleteArtifact: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export function useCanvasArtifact(id: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["canvas", "artifact", id],
    queryFn: async () => {
      if (!id) return null;
      return fetchArtifact(id);
    },
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      userId,
      updates,
    }: {
      id: string;
      userId: string;
      updates: Partial<Pick<CanvasArtifact, "title" | "content" | "type" | "language" | "tags">>;
    }) => updateArtifact(id, userId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas", "artifact", id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => deleteArtifact(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas"] });
    },
  });

  const versionsQuery = useQuery({
    queryKey: ["canvas", "versions", id],
    queryFn: async () => {
      if (!id) return [];
      return fetchVersions(id);
    },
    enabled: !!id,
  });

  return {
    artifact: query.data,
    isLoading: query.isLoading,
    versions: versionsQuery.data ?? [],
    isLoadingVersions: versionsQuery.isLoading,
    updateArtifact: updateMutation.mutateAsync,
    deleteArtifact: deleteMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    refetch: query.refetch,
  };
}

export function useCanvasStream() {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onCompleteRef = useRef<((fullContent: string) => void) | null>(null);
  const onChunkRef = useRef<((chunk: string) => void) | null>(null);

  const stream = useCallback(
    async (params: {
      prompt: string;
      artifactType: ArtifactType;
      language?: string;
      context?: string;
      onChunk?: (chunk: string) => void;
      onComplete?: (fullContent: string) => void;
    }) => {
      const { prompt, artifactType, language, context, onChunk, onComplete } = params;
      onChunkRef.current = onChunk ?? null;
      onCompleteRef.current = onComplete ?? null;

      abortControllerRef.current = new AbortController();
      setIsStreaming(true);
      setContent("");

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        const response = await fetch("/api/canvas/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            artifactType,
            language,
            context,
            userId: user.id,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) throw new Error(`Stream failed: ${response.status}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          full += chunk;
          setContent(full);
          onChunkRef.current?.(chunk);
        }

        onCompleteRef.current?.(full);
        return full;
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          throw e;
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [],
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { content, isStreaming, stream, stop, setContent };
}

export function useCanvasAI() {
  const streamHook = useCanvasStream();

  const generate = useCallback(
    async (params: {
      prompt: string;
      artifactType: ArtifactType;
      language?: string;
      existingContent?: string;
      instruction?:
        "rewrite" | "expand" | "summarize" | "translate" | "explain" | "fix" | "improve";
      onChunk?: (chunk: string) => void;
      onComplete?: (fullContent: string) => void;
    }) => {
      const { prompt, artifactType, language, existingContent, instruction, onChunk, onComplete } =
        params;

      const context = existingContent
        ? `${instruction ? `Instruction: ${instruction}` : ""}\n\nExisting content:\n${existingContent}`
        : undefined;

      const fullPrompt = instruction ? `${instruction.toUpperCase()}: ${prompt}` : prompt;

      return streamHook.stream({
        prompt: fullPrompt,
        artifactType,
        language,
        context,
        onChunk,
        onComplete,
      });
    },
    [streamHook],
  );

  return { ...streamHook, generate };
}
