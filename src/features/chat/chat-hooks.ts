import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ChatMessage, Conversation } from "@/lib/phase2/types";

const db = supabase;

export function useConversations() {
  return useQuery({
    queryKey: ["chat", "conversations"],
    queryFn: async (): Promise<Conversation[]> => {
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) throw new Error("Unauthorized");

      const { data, error } = await db
        .from("conversations")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(mapConversation);
    },
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["chat", "conversation", id],
    queryFn: async (): Promise<Conversation | null> => {
      if (!id) return null;
      const { data, error } = await db.from("conversations").select("*").eq("id", id).single();

      if (error || !data) return null;
      return mapConversation(data);
    },
    enabled: !!id,
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["chat", "messages", conversationId],
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!conversationId) return [];
      const { data, error } = await db
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []).map(mapMessage);
    },
    enabled: !!conversationId,
  });
}

export function useBranchConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      messageId,
      userId,
    }: {
      conversationId: string;
      messageId: string;
      userId: string;
    }): Promise<Conversation> => {
      const { data: source } = await db
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (!source) throw new Error("Source conversation not found");

      const { data: newConv, error } = await db
        .from("conversations")
        .insert({
          user_id: userId,
          project_id: source.project_id,
          title: `Branch of ${source.title ?? "Conversation"}`,
          folder_id: source.folder_id,
          metadata: {
            ...(typeof source.metadata === "object" && source.metadata !== null
              ? (source.metadata as Record<string, unknown>)
              : {}),
            branchedFrom: conversationId,
            branchedFromMessage: messageId,
          },
        })
        .select()
        .single();

      if (error || !newConv) throw error;

      const { data: messages } = await db
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .lte(
          "created_at",
          (await db.from("messages").select("created_at").eq("id", messageId).single()).data
            ?.created_at ?? "",
        )
        .order("created_at", { ascending: true });

      if (messages && messages.length > 0) {
        await db.from("messages").insert(
          messages.map((m: Record<string, unknown>) => ({
            ...m,
            id: undefined,
            conversation_id: newConv.id,
            parent_message_id: m.parent_message_id ?? null,
            branch_from_message_id: messageId,
          })),
        );
      }

      return mapConversation(newConv);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat"] });
      toast.success("Conversation branched");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useEditMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      userId,
      content,
    }: {
      messageId: string;
      userId: string;
      content: string;
    }): Promise<ChatMessage> => {
      const { data, error } = await db
        .from("messages")
        .update({
          content,
          is_edited: true,
          edited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error || !data) throw error;
      return mapMessage(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "messages"] });
    },
  });
}

export function useRegenerateMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      conversationId,
      userId,
    }: {
      messageId: string;
      conversationId: string;
      userId: string;
    }): Promise<ChatMessage> => {
      const { data: existing } = await db.from("messages").select("*").eq("id", messageId).single();

      if (!existing) throw new Error("Message not found");

      const { data, error } = await db
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: "",
          model: existing.model,
          parent_message_id: existing.parent_message_id ?? existing.id,
          branch_from_message_id: existing.parent_message_id,
          is_regenerated: true,
          metadata: { regeneratedFrom: messageId },
          user_id: userId,
        })
        .select()
        .single();

      if (error || !data) throw error;
      return mapMessage(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "messages"] });
      toast.success("Regenerating response...");
    },
  });
}

export function useConversationStats(conversationId: string | null) {
  return useQuery({
    queryKey: ["chat", "stats", conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      const { data, error } = await db
        .from("messages")
        .select("role, content, created_at, model")
        .eq("conversation_id", conversationId);

      if (error || !data) return null;

      const messages = data as Array<{
        role: string;
        content: string | null;
        created_at: string;
        model: string | null;
      }>;
      const userMessages = messages.filter((m: { role: string }) => m.role === "user").length;
      const assistantMessages = messages.filter(
        (m: { role: string }) => m.role === "assistant",
      ).length;
      const models = Array.from(
        new Set(messages.map((m: { model: string | null }) => m.model).filter(Boolean)),
      );
      const totalTokens = messages.reduce(
        (acc: number, m: { content?: string | null }) => acc + (m.content?.length ?? 0) / 4,
        0,
      );

      return {
        totalMessages: messages.length,
        userMessages,
        assistantMessages,
        models,
        totalTokens: Math.round(totalTokens),
        createdAt: messages[0]?.created_at ?? null,
        updatedAt: messages[messages.length - 1]?.created_at ?? null,
      };
    },
    enabled: !!conversationId,
  });
}

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    projectId: row.project_id as string | null,
    title: (row.title as string) ?? "Untitled",
    folderId: row.folder_id as string | null,
    isPinned: row.is_pinned as boolean,
    isFavorite: row.is_favorite as boolean,
    isArchived: row.is_archived as boolean,
    tags: (row.tags as string[]) ?? [],
    summary: row.summary as string | undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastMessageAt: row.last_message_at as string | null,
  };
}

function mapMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as "user" | "assistant" | "system",
    content: (row.content as string) ?? "",
    model: row.model as string | undefined,
    parentMessageId: row.parent_message_id as string | null,
    branchFromMessageId: row.branch_from_message_id as string | null,
    isEdited: row.is_edited as boolean,
    editedAt: row.edited_at as string | null,
    isRegenerated: row.is_regenerated as boolean,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  };
}
