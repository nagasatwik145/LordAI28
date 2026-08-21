import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutPanelLeft, Copy, Check, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { useAppContext } from "@/components/lord/AppContextProvider";
import { ChatSidebar } from "@/components/lord/ChatSidebar";
import { FolderSidebar } from "@/components/lord/folders/FolderSidebar";
import { ShareButton } from "@/components/lord/share/ShareButton";
import type { ConversationWithFolder } from "@/lib/folders";
import { RichMessage } from "@/components/lord/RichMessage";
import { TypingDots } from "@/components/lord/TypingDots";
import { ChatInput } from "@/components/lord/chat/input/ChatInput";
import { ChatErrorBoundary } from "@/components/lord/ChatErrorBoundary";
import ImageGenModal from "@/components/lord/ImageGenModal";
import { detectImageIntent } from "@/lib/ai/image";
import type { ChatSubmitPayload } from "@/components/lord/chat/input/types";
import { getToolDef } from "@/components/lord/chat/input/tools";
import {
  detectCalendarEvent,
  createEventFromDetection,
  type DetectedEvent,
} from "@/lib/calendar-event-detector";
import { useCalendar } from "@/components/lord/CalendarProvider";
import { DEFAULT_MODE, type LordMode } from "@/lib/modes";
import { usePersistedState } from "@/lib/use-persisted-state";
import { tokenUsageStore, type TokenUsageEvent } from "@/lib/token-usage-store";
import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl } from "@/lib/api-config";
import { getSupabaseAuthHeaders } from "@/lib/authenticated-fetch";
import { emitDashboardEvent } from "@/lib/dashboard-service";
import { generateChatTitle, shouldGenerateTitle } from "@/lib/chat-title";
import { cancelTitleGeneration, generateConversationTitle } from "@/lib/title-service";
import { cn } from "@/lib/utils";
import { parseLordError, formatUserFacingError, type LordError } from "@/lib/lord-error";
import { useMessageRealtime } from "@/lib/realtime/use-realtime-sync";
import { createClientTag, markClientTagSent } from "@/lib/realtime/client-tag";
import {
  detectMemories,
  detectSensitive,
  memoryExists,
  useAddMemory,
  useMemories,
  useMemorySettings,
  useSaveDetectedMemory,
  type DetectedMemory,
} from "@/lib/memory";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [{ title: "LORD — Chat" }, { name: "description", content: "Talk to LORD AI." }],
  }),
  component: ChatPage,
});

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  pinned?: boolean;
  favorite?: boolean;
  pinned_at?: string | null;
  sort_order?: number | null;
}

/** Message shape stored in the React Query cache keyed by ["messages", id]. */
interface CachedMessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  created_at: string;
  streaming?: boolean;
  client_tag?: string | null;
}

// A transient conversation inserted into the React Query cache *before* the DB
// request resolves, so the sidebar renders it instantly. Marked with
// `isOptimistic` so it can be identified and migrated/removed without ambiguity.
interface OptimisticConversationRow extends ConversationRow {
  isOptimistic: boolean;
}

// Prefix used for every optimistic id so a real row (uuid) is never confused
// with a temporary one, and so rollback can target exactly the right entry.
const OPTIMISTIC_ID_PREFIX = "temp-";

function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

function createOptimisticConversation(userId: string, title: string): OptimisticConversationRow {
  const now = new Date().toISOString();
  return {
    id: `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`,
    user_id: userId,
    title,
    created_at: now,
    updated_at: now,
    last_message_at: now,
    isOptimistic: true,
  };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  created_at: string;
  streaming?: boolean;
  client_tag?: string | null;
}

// Stable empty references so that a `useQuery` result with no data does NOT
// produce a brand-new array on every render. Returning a fresh `[]` default
// each render would make downstream `useMemo`/effects see a new identity every
// render and, combined with `setMessages`, cause an infinite update loop
// (React error #185: "Maximum update depth exceeded").
const EMPTY_CONVERSATIONS: ConversationRow[] = [];
const EMPTY_STORED_MESSAGES: MessageRow[] = [];

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
}

// Structural comparison used to avoid redundant `setMessages` calls. Each
// `setMessages` clones the array and notifies subscribers, so re-applying an
// identical message list would still force a render; skipping it entirely keeps
// state updates bounded and prevents render loops.
function messagesEqual(a: UIMessage[], b: UIMessage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].role !== b[i].role) return false;
    if (getMessageText(a[i]) !== getMessageText(b[i])) return false;
  }
  return true;
}

// Titles that count as "not meaningfully named" — i.e. the default placeholders
// the app uses for brand-new conversations. A conversation whose title is one of
// these (and which has no messages) is treated as an empty, discardable chat.
// A manually renamed conversation gets a real title and is therefore protected
// from automatic cleanup.
const DEFAULT_CONVERSATION_TITLES = new Set(["", "new chat", "untitled"]);
function isDefaultTitle(title: string | undefined | null): boolean {
  return DEFAULT_CONVERSATION_TITLES.has((title ?? "").trim().toLowerCase());
}

function ChatPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const { metrics, currentRoute, activeWorkflow, history } = useAppContext();
  const calendar = useCalendar();

  const [mode, setMode] = usePersistedState<LordMode>("chat-mode", DEFAULT_MODE);
  const [input, setInput] = useState("");
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [savingMessage, setSavingMessage] = useState(false);
  const [pendingInitialSend, setPendingInitialSend] = useState<{
    conversationId: string;
    message: UIMessage;
  } | null>(null);
  const [pendingEvent, setPendingEvent] = useState<{
    detected: DetectedEvent;
    userMessage: UIMessage;
    conversationId: string;
    isNewConversation: boolean;
  } | null>(null);

  // ---- Long-Term Memory auto-detection --------------------------------------
  // When the user says something worth remembering, we surface a confirmation
  // card (ask-before-save) or auto-save it (above the confidence threshold),
  // depending on the user's memory settings. Detected memories never include
  // sensitive data (passwords, secrets, payment info).
  const { data: memorySettings } = useMemorySettings(user.id);
  const { data: memories = [] } = useMemories(user.id);
  const saveDetected = useSaveDetectedMemory(user.id);
  const addMemory = useAddMemory(user.id);
  const [pendingMemories, setPendingMemories] = useState<{
    detected: DetectedMemory[];
    userMessage: UIMessage;
    conversationId: string;
    isNewConversation: boolean;
  } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  // Scroll-position tracking for the "New messages" affordance. We auto-scroll
  // only when the user is already at the bottom; if they're reading older
  // messages we surface a button instead of yanking the scroll position.
  const atBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const STICK_BOTTOM_THRESHOLD = 120;
  const justLoadedRef = useRef(false);
  // Guards automatic title generation so it runs at most ONCE per conversation.
  const titleGeneratedForRef = useRef<string | null>(null);
  // Mirror of whether the assistant is currently streaming/submitting for the
  // active conversation. Read inside cleanup logic so we NEVER delete a
  // conversation mid-response (e.g. when the user switches away while streaming).
  // Assigned just after `status` is declared (see below).
  const isAssistantStreamingRef = useRef(false);

  // Cross-device streaming: tracks the assistant message row we are incrementally
  // persisting to Supabase so that OTHER devices receive streaming tokens in
  // real time (see the streaming-persist effect below). The originating device
  // already shows tokens via `useChat`; these refs only drive the DB writes
  // that other devices sync.
  const streamingMsgIdRef = useRef<string | null>(null);
  const streamingConvIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>("");
  // Serialize streaming writes. Without this, a fast stream can issue an UPDATE
  // before its INSERT reaches PostgREST, leaving a permanently partial row.
  const streamingWriteRef = useRef<Promise<void>>(Promise.resolve());
  // State updates are committed asynchronously. This ref closes the small
  // window where two rapid clicks can both observe `busy === false` (notably
  // while attachments are being read) and create duplicate user turns.
  const requestInFlightRef = useRef(false);
  const cleanupEmptyConversationRef = useRef<(id: string | null) => Promise<string | null>>(
    async () => null,
  );

  // Clean up the active conversation when the user navigates away from /chat
  // (SPA route change, sign-out) — ChatPage unmounts in all of those cases.
  useEffect(() => {
    return () => {
      void cleanupEmptyConversationRef.current(activeConversationIdRef.current);
    };
  }, []);

  // Clean up on tab close / refresh / browser navigation away. `beforeunload`
  // fires for these and best-effort deletes the empty conversation. The DB
  // user-message count check keeps it safe across tabs; failures are swallowed.
  useEffect(() => {
    const handleBeforeUnload = () => {
      void cleanupEmptyConversationRef.current(activeConversationIdRef.current);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Cancel any in-flight title generation when the page unmounts.
  useEffect(() => {
    return () => {
      if (activeConversationIdRef.current) {
        cancelTitleGeneration(activeConversationIdRef.current);
      }
    };
  }, []);
  const modeRef = useRef<LordMode>(mode);
  const requestBodyRef = useRef({
    mode,
    context: { page: currentRoute, workflow: activeWorkflow, metrics, history },
  });

  requestBodyRef.current = {
    mode,
    context: { page: currentRoute, workflow: activeWorkflow, metrics, history },
  };
  modeRef.current = mode;

  // Conversations list (Supabase)
  const { data: conversationsData } = useQuery({
    queryKey: ["conversations", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return data as ConversationRow[];
    },
  });
  const conversations = conversationsData ?? EMPTY_CONVERSATIONS;
  // Keep the key stable and shared by every cache mutation in this route.
  const conversationsQueryKey = useMemo(() => ["conversations", user.id] as const, [user.id]);

  // Enrich conversations with their folder_id (the DB column is selected via `*`)
  // so the FolderSidebar can group them. Stable memo keeps identity across renders.
  const conversationsWithFolder = useMemo<ConversationWithFolder[]>(
    () =>
      conversations.map((c) => ({
        ...c,
        folder_id: (c as ConversationRow & { folder_id?: string | null }).folder_id ?? null,
      })),
    [conversations],
  );

  // Optimistically reparent a conversation in the conversations cache (used by the
  // folder drag-and-drop). Mirrors `patchConversation` for the folder_id field.
  const patchConversationFolder = useCallback(
    (id: string, folderId: string | null) => {
      qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) => {
        if (!old) return old;
        return old.map((c) =>
          c.id === id ? { ...c, folder_id: folderId, sort_order: null } : c,
        ) as ConversationRow[];
      });
    },
    [conversationsQueryKey, qc],
  );

  // Messages for active conversation
  const {
    data: storedMessagesData,
    error: storedMessagesError,
    isFetching: messagesFetching,
  } = useQuery({
    queryKey: ["messages", conversationId],
    // Temporary ids are UI-only. In particular, never serialize one into a
    // PostgREST filter for the UUID conversation_id column.
    enabled: !!conversationId && !isOptimisticId(conversationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as MessageRow[];
    },
  });
  // Fall back to a *stable* empty array (not a fresh `[]` each render) so that
  // `initialMessages` keeps a stable identity while the query has no data.
  const storedMessages = storedMessagesData ?? EMPTY_STORED_MESSAGES;

  const initialMessages = useMemo<UIMessage[]>(
    () =>
      storedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text", text: m.content }],
        })),
    [storedMessages],
  );

  // Latest initialMessages, read inside effects via a ref so the sync effect
  // does NOT depend on `initialMessages` (a useMemo object). Depending on it
  // let the effect re-fire whenever the memo's reference changed between
  // renders, which (on production builds) caused an infinite
  // setMessages ↔ re-render synchronization loop.
  const initialMessagesRef = useRef(initialMessages);
  initialMessagesRef.current = initialMessages;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${getApiBaseUrl()}/api/chat`,
        headers: getSupabaseAuthHeaders,
        body: () => requestBodyRef.current,
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, error, regenerate, stop } = useChat({
    id: conversationId ?? "draft",
    messages: initialMessages,
    transport,
    onFinish: async ({ message, messages: completed, isError }) => {
      const meta = (message?.metadata ?? null) as { tokenUsage?: TokenUsageEvent } | null;
      if (meta?.tokenUsage) {
        tokenUsageStore.record(meta.tokenUsage);
      }
      // The stream belongs to the conversation captured when its persistence
      // row was created, not whichever conversation the user happens to view
      // when the callback eventually fires.
      const activeConversationId = streamingConvIdRef.current ?? activeConversationIdRef.current;
      const requestMode = modeRef.current;
      const dbActiveConversationId = activeConversationId ?? "";
      if (isError) {
        const partialMessageId = streamingMsgIdRef.current;
        if (partialMessageId) {
          await streamingWriteRef.current;
          const tag = createClientTag();
          markClientTagSent(tag);
          const { error: finalizeError } = await supabase
            .from("messages")
            .update({ streaming: false, client_tag: tag })
            .eq("id", partialMessageId);
          if (finalizeError) setPersistenceError(finalizeError.message);
        }
        streamingMsgIdRef.current = null;
        streamingConvIdRef.current = null;
        streamingContentRef.current = "";
        // Surface the real, request-correlated reason instead of a generic line.
        // The assistant message carries an error part whose text is a JSON
        // `LordError` produced by the backend `onError` handler.
        const errPart = (
          message?.parts as Array<{ type: string; errorText?: string }> | undefined
        )?.find((p) => p.type === "error");
        const lordErr = errPart?.errorText ? parseLordError(errPart.errorText) : null;
        setPersistenceError(
          lordErr
            ? formatUserFacingError(lordErr)
            : "The response was interrupted. You can regenerate it.",
        );
        return;
      }
      if (!activeConversationId || isOptimisticId(dbActiveConversationId)) {
        console.warn(
          JSON.stringify({
            event: "chat_stream_finish_skipped",
            conversationId: activeConversationId,
            mode: requestMode,
            isError,
          }),
        );
        return;
      }

      const assistantMessage = completed
        .slice()
        .reverse()
        .find((m) => m.role === "assistant");
      const content =
        assistantMessage?.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join("") ?? "";

      // Finalize cross-device streaming: if `onChunk` already created the
      // assistant row incrementally, flip `streaming` off and write the final
      // content (+ server timestamp). Otherwise (e.g. a non-text response, or a
      // path where streaming tracking was skipped) insert the row normally.
      const streamingMsgId = streamingMsgIdRef.current;
      const wasStreaming = streamingMsgId && !isOptimisticId(dbActiveConversationId);
      await streamingWriteRef.current;
      streamingMsgIdRef.current = null;
      streamingConvIdRef.current = null;
      streamingContentRef.current = "";

      if (content.trim()) {
        if (wasStreaming) {
          const tag = createClientTag();
          markClientTagSent(tag);
          const { error: finErr } = await supabase
            .from("messages")
            .update({ content, streaming: false, client_tag: tag })
            .eq("id", streamingMsgId!);
          if (finErr) {
            console.error(
              JSON.stringify({
                event: "supabase_stream_finish_error",
                table: "messages",
                role: "assistant",
                conversationId: dbActiveConversationId,
                messageId: streamingMsgId,
                mode: requestMode,
                error: finErr.message,
              }),
            );
            setPersistenceError(finErr.message);
          } else {
            // The SDK's generated message id is not guaranteed to be a UUID.
            // Replace it with the persisted UUID so regenerate/delete target
            // the exact database row rather than creating a second response.
            if (assistantMessage) {
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantMessage.id ? { ...item, id: streamingMsgId! } : item,
                ),
              );
            }
            console.info(
              JSON.stringify({
                event: "supabase_stream_finish_success",
                table: "messages",
                role: "assistant",
                conversationId: dbActiveConversationId,
                messageId: streamingMsgId,
                mode: requestMode,
              }),
            );
          }
        } else {
          const assistantMessageId = crypto.randomUUID();
          const tag = createClientTag();
          markClientTagSent(tag);
          console.info(
            JSON.stringify({
              event: "supabase_insert_start",
              table: "messages",
              role: "assistant",
              conversationId: dbActiveConversationId,
              messageId: assistantMessageId,
              mode: requestMode,
            }),
          );
          const { error: insertError } = await supabase.from("messages").insert({
            id: assistantMessageId,
            conversation_id: dbActiveConversationId,
            user_id: user.id,
            role: "assistant",
            content,
            model: requestMode,
            client_tag: tag,
          });
          if (insertError) {
            console.error(
              JSON.stringify({
                event: "supabase_insert_error",
                table: "messages",
                role: "assistant",
                conversationId: dbActiveConversationId,
                messageId: assistantMessageId,
                mode: requestMode,
                error: insertError.message,
              }),
            );
            setPersistenceError(insertError.message);
          } else {
            console.info(
              JSON.stringify({
                event: "supabase_insert_success",
                table: "messages",
                role: "assistant",
                conversationId: dbActiveConversationId,
                messageId: assistantMessageId,
                mode: requestMode,
              }),
            );
          }
        }
      }
      const { error: updateError } = await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", dbActiveConversationId);
      if (updateError) {
        console.error(
          JSON.stringify({
            event: "supabase_update_error",
            table: "conversations",
            conversationId: dbActiveConversationId,
            error: updateError.message,
          }),
        );
        setPersistenceError(updateError.message);
      }
      qc.invalidateQueries({ queryKey: conversationsQueryKey });
      qc.invalidateQueries({ queryKey: ["messages", dbActiveConversationId] });
    },
  });

  isAssistantStreamingRef.current = status === "submitted" || status === "streaming";

  // Creation promises are deliberately kept outside React state. The matching
  // temp id is only for rendering an optimistic sidebar row; callers must await
  // this promise before issuing *any* database request that uses conversation_id.
  const creationPromiseByTempRef = useRef<Record<string, Promise<ConversationRow>>>({});

  const ensureConversation = async (firstMessage: string): Promise<string> => {
    if (!conversationId) {
      createConversationOptimistic(firstMessage.slice(0, 60) || "New conversation");
    }

    const selectedId = activeConversationIdRef.current;
    if (!selectedId) throw new Error("Conversation creation did not select a conversation.");
    if (!isOptimisticId(selectedId)) return selectedId;

    const creation = creationPromiseByTempRef.current[selectedId];
    if (!creation) throw new Error("Conversation creation is not in progress.");
    const created = await creation;
    return created.id;
  };

  // Optimistic conversation creation.
  //
  // The temporary conversation is injected into the cache immediately (inside
  // `createConversationOptimistic`, so `ensureConversation`/`handleNewChat` return
  // the temp id without awaiting). The mutation then performs the real insert and,
  // on success, swaps the temp row for the real one in place.
  //
  // onMutate  - cancel in-flight refetches and snapshot the previous cache. The
  //             optimistic row itself is inserted by the caller so the temp id is
  //             available synchronously; onMutate only provides rollback context.
  // onError   - restore the snapshot (removes the temporary row) and surface a
  //             non-blocking toast; the optimistic id is cleared from selection.
  // onSuccess - swap the temporary row for the real Supabase record in the same
  //             array slot (no remount, no flicker), then re-point selection and
  //             refs at the real id. No messages exist under the temporary id.
  // onSettled - invalidate the list to reconcile with the server and emit the
  //             dashboard event so other widgets stay consistent.
  const createConversation = useMutation({
    mutationFn: async ({ title, tempId }: { title: string; tempId: string }) => {
      const tag = createClientTag();
      markClientTagSent(tag);
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title, client_tag: tag })
        .select()
        .single();
      if (error) throw error;
      return { row: data as ConversationRow, tempId };
    },
    onMutate: async () => {
      // Cancel any outgoing refetch so it can't overwrite our optimistic value.
      await qc.cancelQueries({ queryKey: conversationsQueryKey });
      // Snapshot the previous value for rollback.
      const previous = qc.getQueryData<ConversationRow[]>(conversationsQueryKey);
      return { previous };
    },
    onError: (err, _vars, context) => {
      // Rollback: restore the exact previous cache snapshot. If there was no
      // previous data, clear the list entirely so no fake conversation lingers.
      if (context?.previous) {
        qc.setQueryData(conversationsQueryKey, context.previous);
      } else {
        qc.setQueryData(conversationsQueryKey, []);
      }
      // Remove the optimistic conversation from the cache if it is still present.
      const tempId = _vars.tempId;
      qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) =>
        (old ?? []).filter((c) => c.id !== tempId),
      );
      delete creationPromiseByTempRef.current[tempId];
      // If the failed optimistic conversation was the active selection, reset it.
      if (conversationId === tempId || activeConversationIdRef.current === tempId) {
        startNewChat();
      }
      toast.error("Couldn't create the conversation. Please try again.", {
        description: err instanceof Error ? err.message : undefined,
      });
    },
    onSuccess: async ({ row: realRow, tempId }) => {
      // Swap the temporary id for the real one *in place* so React keeps the same
      // list element key — no remount, no flicker, scroll position preserved.
      qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) => {
        if (!old) return [realRow];
        return old.map((c) => (c.id === tempId ? realRow : c));
      });

      // Re-point selection and refs at the real id.
      if (conversationId === tempId || activeConversationIdRef.current === tempId) {
        setConversationId(realRow.id);
        activeConversationIdRef.current = realRow.id;
      }

      console.info(
        JSON.stringify({
          event: "supabase_insert_success",
          table: "conversations",
          conversationId: realRow.id,
          mode,
        }),
      );

      // If the user navigated away (or closed the tab) while this optimistic
      // conversation was still being created, it is now an empty orphan in the
      // database. Clean it up so empty "New Chat" rows don't accumulate. The
      // authoritative emptiness check (DB user-message count) guarantees we never
      // delete a conversation that actually has messages.
      if (activeConversationIdRef.current !== realRow.id) {
        void cleanupEmptyConversation(realRow.id);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: conversationsQueryKey });
      emitDashboardEvent("conversations");
    },
  });

  // Inserts an optimistic UI row and starts the real insert. The returned temp id
  // is never a database id: submitters await its stored promise before writing.
  const createConversationOptimistic = (title: string): string => {
    const temp = createOptimisticConversation(user.id, title);
    qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) => [temp, ...(old ?? [])]);
    setConversationId(temp.id);
    activeConversationIdRef.current = temp.id;
    const creation = createConversation.mutateAsync({ title, tempId: temp.id });
    creationPromiseByTempRef.current[temp.id] = creation.then(({ row }) => row);
    // A user may create an empty chat and never send. React Query handles the
    // visible error; this prevents an unhandled rejected promise in that case.
    void creation.catch(() => undefined);
    return temp.id;
  };

  // --- Optimistic conversation-list cache helpers ---------------------------
  //
  // All sidebar mutations below write to the React Query cache *first* via
  // `setQueryData` (instant UI), snapshot the prior value for rollback, then
  // reconcile with the server on success. We never `invalidate` the whole list
  // on success — instead we re-order/re-key the existing array in place so the
  // sidebar never flashes, jumps, or loses selection/scroll.

  // Apply a partial patch to one conversation row in the cached list, returning
  // a NEW array (immutable update) so React re-renders only the affected row.
  const patchConversation = (id: string, patch: Partial<ConversationRow>): void => {
    qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) => {
      if (!old) return old;
      return old.map((c) => (c.id === id ? { ...c, ...patch } : c));
    });
  };

  // Move a conversation to the top of the cached list (newest-first), preserving
  // everything else. Used the instant a message is sent so the chat jumps to the
  // top of the sidebar without waiting for Supabase.
  const moveConversationToTop = (id: string): void => {
    qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) => {
      if (!old) return old;
      const target = old.find((c) => c.id === id);
      if (!target) return old;
      const now = new Date().toISOString();
      // Optimistically bump last_message_at so the time-bucket + order update
      // immediately; the server's real timestamp replaces it on reconcile.
      const bumped = { ...target, last_message_at: now };
      return [bumped, ...old.filter((c) => c.id !== id)];
    });
  };

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const tag = createClientTag();
      markClientTagSent(tag);
      const { error } = await supabase
        .from("conversations")
        .update({ title, client_tag: tag })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: conversationsQueryKey });
      const previous = qc.getQueryData<ConversationRow[]>(conversationsQueryKey);
      // Instant title change in the sidebar.
      patchConversation(id, { title });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(conversationsQueryKey, context.previous);
      toast.error("Couldn't rename conversation.");
    },
    // Reconcile only the affected query; no full invalidation.
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: conversationsQueryKey, exact: true });
      if (id === conversationId) {
        qc.invalidateQueries({ queryKey: ["messages", id] });
      }
    },
  });

  // Generate a title for a conversation at most once, using the first meaningful
  // user prompt. Prefers AI generation via /api/title and falls back to the
  // improved heuristic. Never overwrites a conversation that has already been
  // renamed (non-default title). Failures are logged and swallowed so the
  // conversation stays usable.
  const maybeGenerateTitle = async (convId: string, userPrompt: string, storedTitle: string) => {
    if (titleGeneratedForRef.current === convId) return;
    if (!shouldGenerateTitle(storedTitle)) {
      titleGeneratedForRef.current = convId;
      return;
    }
    titleGeneratedForRef.current = convId;
    try {
      const generated = await generateConversationTitle(userPrompt, convId);
      if (!generated) return;
      await renameMutation.mutateAsync({ id: convId, title: generated });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "chat_title_generate_error",
          conversationId: convId,
          error: err instanceof Error ? err.message : "Failed to generate title",
        }),
      );
      // Allow a later attempt if persistence failed.
      if (titleGeneratedForRef.current === convId) titleGeneratedForRef.current = null;
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // A sidebar action can race the initial insert. A temporary row has no
      // database representation, so removing it must remain a UI-only action.
      if (isOptimisticId(id)) return;
      const { error: messagesError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", id);
      if (messagesError) throw messagesError;
      const { error } = await supabase.from("conversations").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: conversationsQueryKey });
      const previous = qc.getQueryData<ConversationRow[]>(conversationsQueryKey);
      // Remove instantly from the sidebar. Also drop the cached message list so
      // re-opening never flashes stale data.
      qc.setQueryData<ConversationRow[]>(conversationsQueryKey, (old) =>
        (old ?? []).filter((c) => c.id !== id),
      );
      qc.removeQueries({ queryKey: ["messages", id] });
      // Cancel any in-flight title generation for this conversation.
      cancelTitleGeneration(id);
      return { previous, id };
    },
    onError: (_err, id, context) => {
      // Rollback only server state; keep UI responsive.
      if (context?.previous) qc.setQueryData(conversationsQueryKey, context.previous);
      toast.error("Couldn't delete conversation.", {
        description: "Tap to retry.",
        action: {
          label: "Retry",
          onClick: () => deleteMutation.mutate(id),
        },
      });
    },
    onSuccess: (_d, id) => {
      // Reconcile the single affected list; no full invalidation.
      qc.invalidateQueries({ queryKey: conversationsQueryKey, exact: true });
      if (id === conversationId) startNewChat();
    },
  });

  // Pin / unpin. Optimistic: the row flips `pinned` + `pinned_at` immediately so
  // the conversation jumps to/ from the PINNED section without a network wait.
  const pinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const tag = createClientTag();
      markClientTagSent(tag);
      const { error } = await supabase
        .from("conversations")
        .update({ pinned, pinned_at: pinned ? new Date().toISOString() : null, client_tag: tag })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, pinned }) => {
      await qc.cancelQueries({ queryKey: conversationsQueryKey });
      const previous = qc.getQueryData<ConversationRow[]>(conversationsQueryKey);
      patchConversation(id, {
        pinned,
        pinned_at: pinned ? new Date().toISOString() : null,
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(conversationsQueryKey, context.previous);
      toast.error("Couldn't update pin.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationsQueryKey, exact: true });
    },
  });

  // Favorite / unfavorite. Optimistic star toggle in the sidebar.
  const favoriteMutation = useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const tag = createClientTag();
      markClientTagSent(tag);
      const { error } = await supabase
        .from("conversations")
        .update({ favorite, client_tag: tag })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, favorite }) => {
      await qc.cancelQueries({ queryKey: conversationsQueryKey });
      const previous = qc.getQueryData<ConversationRow[]>(conversationsQueryKey);
      patchConversation(id, { favorite });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(conversationsQueryKey, context.previous);
      toast.error("Couldn't update favorite.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationsQueryKey, exact: true });
    },
  });

  // Optimistically write a single user message into the cached message list for
  // a conversation, so the preview/ordering feel instant. Used as a complementary
  // cache update alongside the Supabase insert; reconciled via invalidate on
  // success and rolled back (by refetch) on error.
  const optimisticUpsertMessage = (message: CachedMessageRow): void => {
    const key = ["messages", message.conversation_id] as const;
    qc.setQueryData<CachedMessageRow[]>(key, (old) => {
      const existing = old ?? [];
      if (existing.some((m) => m.id === message.id)) return existing;
      return [...existing, message];
    });
  };

  // Counts the real user messages persisted for a conversation. This is the
  // authoritative emptiness check (unlike local `messages` state) and is safe
  // across multiple tabs: it reads the database directly, so a conversation that
  // has messages in another tab is never wrongly deleted here.
  const countUserMessages = async (id: string): Promise<number> => {
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", id)
      .eq("role", "user");
    if (error) throw error;
    return count ?? 0;
  };

  // ChatGPT-style automatic cleanup of empty conversations. A conversation is
  // "empty" (and therefore discardable) only when it has zero persisted user
  // messages. It is NEVER deleted while the assistant is streaming, and never
  // deleted if the user has manually renamed it (non-default title). Failures are
  // swallowed and logged — the conversation is always kept on error.
  //
  // Returns the real id that was deleted (for chaining) or null if no deletion
  // happened, so callers can avoid redundant work.
  const cleanupEmptyConversation = async (id: string | null): Promise<string | null> => {
    if (!id) return null;
    // Optimistic temp ids have no database row yet; nothing to clean up here.
    // (An empty conversation that was *created* optimistically is handled once
    // its real id lands — see `createConversation.onSuccess`.)
    if (isOptimisticId(id)) return null;
    // Never delete a conversation whose assistant reply is still in flight.
    if (isAssistantStreamingRef.current) return null;
    // Protect manually renamed conversations (they carry a real, non-default title).
    const row = qc.getQueryData<ConversationRow[]>(conversationsQueryKey)?.find((c) => c.id === id);
    if (row && !isDefaultTitle(row.title)) return null;
    try {
      const userCount = await countUserMessages(id);
      if (userCount > 0) return null; // has at least one real user message → keep
      await deleteMutation.mutateAsync(id).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            event: "conversation_cleanup_error",
            conversationId: id,
            error: err instanceof Error ? err.message : "Failed to clean up conversation",
          }),
        );
      });
      return id;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "conversation_cleanup_count_error",
          conversationId: id,
          error: err instanceof Error ? err.message : "Failed to count messages",
        }),
      );
      return null;
    }
  };
  cleanupEmptyConversationRef.current = cleanupEmptyConversation;

  // Leaves the given conversation, cleaning it up first if it is empty. Used
  // whenever the user switches away from a conversation (New Chat / open another).
  const leaveConversation = (id: string | null) => {
    if (!id) return;
    void cleanupEmptyConversation(id);
  };

  // Pure reset of chat state. Used internally for rollback (a failed optimistic
  // create) and when the active conversation is deleted. It intentionally does
  // NOT create a new conversation — see `handleNewChat` for that.
  const startNewChat = () => {
    // Clean up the conversation we are leaving (if it is empty) before resetting.
    leaveConversation(activeConversationIdRef.current);
    setPersistenceError(null);
    setSavingMessage(false);
    setPendingInitialSend(null);
    setPendingEvent(null);
    setConversationId(null);
    activeConversationIdRef.current = null;
    titleGeneratedForRef.current = null;
    setMessages([]);
  };

  // "New Chat" button handler. Resets the composer state and optimistically
  // creates a conversation so it appears in the sidebar and becomes the active
  // selection instantly, before Supabase responds.
  const handleNewChat = () => {
    if (busy) {
      toast.info("Wait for the current response to finish before starting another chat.");
      return;
    }
    startNewChat();
    createConversationOptimistic("New Chat");
  };

  const loadConversation = (id: string) => {
    if (busy) {
      toast.info("Wait for the current response to finish before switching conversations.");
      return;
    }
    // Clean up the conversation we are switching away from (if it is empty).
    leaveConversation(activeConversationIdRef.current);
    setPersistenceError(null);
    setPendingInitialSend(null);
    setPendingEvent(null);
    setConversationId(id);
    activeConversationIdRef.current = id;
    titleGeneratedForRef.current = null;
    justLoadedRef.current = true; // signal the once-only sync effect to load stored messages
    setMessages([]); // will be replaced by initialMessages once query loads
  };

  // Send a user message to the AI, choosing the right path for new vs. existing
  // conversations. The user message is already persisted in Supabase at this point.
  const sendToAI = (message: UIMessage, conversationId: string, isNew: boolean) => {
    if (isNew) {
      setPendingInitialSend({ conversationId, message });
    } else {
      void sendMessage(message)
        .catch((err: unknown) => {
          setPersistenceError(err instanceof Error ? err.message : "The AI request failed.");
        })
        .finally(() => {
          requestInFlightRef.current = false;
          setSavingMessage(false);
        });
    }
  };

  // Handle the YES/NO confirmation for an AI-detected calendar event.
  const resolvePendingEvent = (accept: boolean) => {
    if (!pendingEvent) return;
    const { detected, userMessage, conversationId, isNewConversation } = pendingEvent;
    if (accept) {
      calendar.addEvent(createEventFromDetection(detected));
    }
    setPendingEvent(null);
    sendToAI(userMessage, conversationId, isNewConversation);
  };

  // Convert a cached/stored DB message row into the UIMessage shape used by the
  // in-memory `useChat` message list. Shared by the realtime merge + load path.
  const dbRowToUIMessage = (row: { id: string; role: string; content: string }): UIMessage => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    parts: [{ type: "text", text: row.content }],
  });

  // Track whether the user is pinned to the bottom of the scroll area. Used to
  // decide between auto-scrolling (they're following along) and showing a
  // "New messages" button (they're reading older content). Never steal scroll.
  const updateAtBottom = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance <= STICK_BOTTOM_THRESHOLD;
    if (atBottomRef.current) setShowNewMessages(false);
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateAtBottom, { passive: true });
    return () => el.removeEventListener("scroll", updateAtBottom);
  }, []);

  // Auto-scroll on local changes ONLY when the user is already near the bottom.
  useEffect(() => {
    if (atBottomRef.current) {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    } else if (messages.length > 0) {
      setShowNewMessages(true);
    }
  }, [messages, status, user.id]);

  // ---- Cross-device live message sync -------------------------------------
  // Subscribes to realtime message events for the ACTIVE conversation only
  // (reuses the single shared websocket). For each remote row we merge it into
  // the live `useChat` message list so streaming tokens and new messages appear
  // elsewhere on this device instantly, without re-fetching or recreating the
  // list. Local (self) echoes are already dropped by the client-tag layer, so
  // this only applies genuinely remote changes.
  useMessageRealtime(conversationId, (event) => {
    if (event.eventType === "DELETE") {
      const id = event.old?.["id"] as string | undefined;
      if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
      return;
    }
    const row = event.new as {
      id: string;
      role: string;
      content: string;
      streaming?: boolean;
    } | null;
    if (!row) return;
    const uiMessage = dbRowToUIMessage(row);
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === row.id);
      if (idx >= 0) {
        // Update existing (streaming token append or edit) in place.
        const next = prev.slice();
        next[idx] = { ...next[idx], ...uiMessage };
        return next;
      }
      // Append new remote message, keeping chronological order by id stability.
      return [...prev, uiMessage];
    });
    // If the user is following along, keep them pinned; otherwise prompt.
    if (!atBottomRef.current && row.role === "assistant") {
      setShowNewMessages(true);
    }
  });

  const scrollToBottom = () => {
    atBottomRef.current = true;
    setShowNewMessages(false);
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  };

  const busy = savingMessage || status === "submitted" || status === "streaming";

  // Cross-device streaming persistence. As the assistant streams on THIS device,
  // we keep its Supabase row updated so OTHER devices render the same tokens in
  // real time (they receive the realtime UPDATEs). We watch the live `messages`
  // array (the source of truth for rendering) and diff the streaming assistant
  // message: INSERT once on first sight, UPDATE with each new content length.
  // `useChat` does not expose a chunk callback, so deriving deltas from the
  // rendered message list is the robust, type-safe path. The originating
  // device's own writes are self-suppressed (client_tag), so they never
  // double-apply to the local React Query cache.
  useEffect(() => {
    const convId = activeConversationIdRef.current ?? "";
    if (!convId || isOptimisticId(convId)) return;
    const last = messages[messages.length - 1];
    const isStreaming = status === "streaming" || status === "submitted";
    if (!last || last.role !== "assistant" || !isStreaming) return;
    const content = getMessageText(last);
    if (!content) return;

    if (!streamingMsgIdRef.current) {
      const msgId = crypto.randomUUID();
      streamingMsgIdRef.current = msgId;
      streamingConvIdRef.current = convId;
      streamingContentRef.current = content; // track last persisted content
      const tag = createClientTag();
      markClientTagSent(tag);
      streamingWriteRef.current = streamingWriteRef.current
        .then(async () => {
          const { error: insertError } = await supabase.from("messages").insert({
            id: msgId,
            conversation_id: convId,
            user_id: user.id,
            role: "assistant",
            content,
            model: modeRef.current,
            streaming: true,
            client_tag: tag,
          });
          if (insertError) throw insertError;
          const { error: touchError } = await supabase
            .from("conversations")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", convId);
          if (touchError) throw touchError;
        })
        .catch((err: unknown) => {
          setPersistenceError(err instanceof Error ? err.message : "Unable to save the response.");
        });
    } else if (content !== streamingContentRef.current) {
      streamingContentRef.current = content;
      const tag = createClientTag();
      markClientTagSent(tag);
      const msgId = streamingMsgIdRef.current;
      streamingWriteRef.current = streamingWriteRef.current
        .then(async () => {
          const { error: updateError } = await supabase
            .from("messages")
            .update({ content, client_tag: tag })
            .eq("id", msgId);
          if (updateError) throw updateError;
        })
        .catch((err: unknown) => {
          setPersistenceError(err instanceof Error ? err.message : "Unable to save the response.");
        });
    }
  }, [messages, status, user.id]);

  // Sync the messages loaded from Supabase into the chat when a conversation is
  // opened from the sidebar. This must run EXACTLY ONCE per opened conversation,
  // after the messages query has settled (not while it is still fetching a
  // partial snapshot), and ONLY for conversations opened via `loadConversation`
  // (signalled by `justLoadedRef`).
  //
  // The previous version watched `messages`/`initialMessages` continuously and
  // overwrote the live chat array whenever they differed. Because `onFinish`
  // persists the assistant message and then invalidates the messages query, the
  // refetch returns asynchronously: there was a window where `initialMessages`
  // held a stale/partial DB snapshot, so the effect replaced the live, fully
  // streamed messages with that partial snapshot — making messages disappear.
  // Gating on `justLoadedRef` (set only by `loadConversation`) + `isFetching`
  // ensures we apply the DB snapshot once, before any streaming begins, and
  // never clobber the live conversation afterwards.
  useEffect(() => {
    if (!justLoadedRef.current) return;
    if (messagesFetching) return;
    if (storedMessagesData === undefined) return;
    if (pendingInitialSend) return;
    justLoadedRef.current = false;
    const next = initialMessagesRef.current;
    setMessages((prev) => (messagesEqual(prev, next) ? prev : next));
  }, [storedMessagesData, messagesFetching, pendingInitialSend, setMessages]);
  useEffect(() => {
    if (
      !pendingInitialSend ||
      conversationId !== pendingInitialSend.conversationId ||
      status !== "ready"
    ) {
      return;
    }

    setMessages([pendingInitialSend.message]);
    setPendingInitialSend(null);
    console.info(
      JSON.stringify({
        event: "chat_stream_start",
        conversationId,
        mode: modeRef.current,
        messageId: pendingInitialSend.message.id,
      }),
    );
    void sendMessage()
      .catch((err: unknown) => {
        setPersistenceError(err instanceof Error ? err.message : "The AI request failed.");
      })
      .finally(() => {
        requestInFlightRef.current = false;
        setSavingMessage(false);
      });
  }, [conversationId, pendingInitialSend, sendMessage, setMessages, status]);

  const buildMessageText = async (payload: ChatSubmitPayload): Promise<string> => {
    let text = payload.text;
    if (payload.tool) {
      const tool = getToolDef(payload.tool);
      if (tool) text = `[${tool.label}] ${text}`;
    }
    const notes: string[] = [];
    const blocks: string[] = [];
    for (const att of payload.attachments) {
      notes.push(`- ${att.name} (${att.kind}, ${(att.size / 1024).toFixed(0)} KB)`);
      const isTextLike =
        att.kind === "file" &&
        (att.file.type.startsWith("text/") ||
          /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|css|html|log|yml|yaml)$/i.test(att.name));
      if (isTextLike && att.size <= 32 * 1024) {
        try {
          const content = await att.file.text();
          blocks.push(`\n\n--- ${att.name} ---\n${content.slice(0, 8000)}`);
        } catch {
          /* ignore unreadable files */
        }
      }
    }
    if (notes.length) text += `\n\nAttached files:\n${notes.join("\n")}`;
    if (blocks.length) text += blocks.join("");
    return text;
  };

  // Run memory detection on the user's message and either auto-save or queue a
  // confirmation prompt, according to the user's memory settings. Runs after the
  // message has already been persisted so detection never blocks sending.
  const processMemoryDetection = (
    text: string,
    userMessage: UIMessage,
    conversationId: string,
    isNewConversation: boolean,
  ): boolean => {
    const settings = memorySettings;
    // Memory disabled entirely → never detect.
    if (settings && settings.memory_enabled === false) return false;
    // Nothing to remember if it's sensitive.
    if (detectSensitive(text)) return false;

    const detected = detectMemories(text);
    if (detected.length === 0) return false;

    const novel = detected.filter((d) => !memoryExists(memories, d.content));
    if (novel.length === 0) return false;

    const threshold = settings?.confidence_threshold ?? 0.65;
    const autoSave = settings?.auto_save ?? true;
    const askBefore = settings?.ask_before_save ?? true;

    const toSave = novel.filter((d) => d.confidence >= threshold);
    const toAsk = novel.filter((d) => d.confidence < threshold);

    for (const d of toSave) {
      if (autoSave) {
        void saveDetected.mutateAsync(d).catch(() => {
          /* swallow — memory is best-effort */
        });
      } else if (askBefore) {
        toAsk.push(d);
      }
    }

    if (toAsk.length > 0) {
      setPendingMemories({ detected: toAsk, userMessage, conversationId, isNewConversation });
      return true;
    }
    return false;
  };

  const resolvePendingMemories = (accept: boolean) => {
    if (!pendingMemories) return;
    if (accept) {
      for (const d of pendingMemories.detected) {
        void addMemory
          .mutateAsync({
            content: d.content,
            category: d.category,
            confidence: d.confidence,
            source: "auto",
          })
          .catch(() => {});
      }
    }
    setPendingMemories(null);
    // Continue sending the original message to the AI.
    sendToAI(
      pendingMemories.userMessage,
      pendingMemories.conversationId,
      pendingMemories.isNewConversation,
    );
  };

  const submit = async (payload: ChatSubmitPayload) => {
    if (requestInFlightRef.current || busy) return;
    if (payload.tool === "create-image" || detectImageIntent(payload.text)) {
      setImagePrompt(
        payload.text.replace(/^(generate|create) an? image(?: of|:)?\s*/i, "").trim() ||
          payload.text,
      );
      setImageModalOpen(true);
      return;
    }
    requestInFlightRef.current = true;
    // Read the ref as well as state: a New Chat click updates the ref
    // synchronously, while React state is applied on the next render.
    try {
      const text = await buildMessageText(payload);
      if (!text.trim()) {
        requestInFlightRef.current = false;
        return;
      }
      setPersistenceError(null);
      const isNewConversation =
        !conversationId ||
        isOptimisticId(conversationId) ||
        isOptimisticId(activeConversationIdRef.current ?? "");
      setSavingMessage(true);
      // The sidebar may be optimistic, but message persistence waits for the
      // conversation insert and receives the real UUID.
      const convId = await ensureConversation(text);
      activeConversationIdRef.current = convId;
      const dbConvId = convId;
      console.info(
        JSON.stringify({
          event: "chat_submit",
          conversationId: convId,
          dbConversationId: dbConvId,
          mode,
          isNewConversation,
          isOptimistic: false,
        }),
      );
      const userMsgId = crypto.randomUUID();
      const userMessage: UIMessage = {
        id: userMsgId,
        role: "user",
        parts: [{ type: "text", text }],
      };

      // --- Instant sidebar feedback (no network wait) -----------------------
      // 1) Move the conversation to the top of the list right away.
      moveConversationToTop(dbConvId);
      // 2) Optimistically insert the user message into the cached message list
      //    for this conversation so previews/ordering update immediately.
      optimisticUpsertMessage({
        id: userMsgId,
        conversation_id: dbConvId,
        user_id: user.id,
        role: "user",
        content: text,
        model: mode,
        created_at: new Date().toISOString(),
      });

      console.info(
        JSON.stringify({
          event: "supabase_insert_start",
          table: "messages",
          role: "user",
          conversationId: dbConvId,
          messageId: userMsgId,
          mode,
        }),
      );
      const { error: insertError } = await supabase.from("messages").insert({
        id: userMsgId,
        conversation_id: dbConvId,
        user_id: user.id,
        role: "user",
        content: text,
        model: mode,
        client_tag: (() => {
          const t = createClientTag();
          markClientTagSent(t);
          return t;
        })(),
      });
      if (insertError) {
        console.error(
          JSON.stringify({
            event: "supabase_insert_error",
            table: "messages",
            role: "user",
            conversationId: dbConvId,
            messageId: userMsgId,
            mode,
            error: insertError.message,
          }),
        );
        throw insertError;
      }
      console.info(
        JSON.stringify({
          event: "supabase_insert_success",
          table: "messages",
          role: "user",
          conversationId: dbConvId,
          messageId: userMsgId,
          mode,
        }),
      );
      const existing = qc
        .getQueryData<ConversationRow[]>(conversationsQueryKey)
        ?.find((c) => c.id === convId);
      const touchPromise = supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", convId)
        .then(({ error }) => error);
      maybeGenerateTitle(convId, text, existing ? existing.title : "");

      // Detect calendar event in user message — confirm before persisting.
      const detected = detectCalendarEvent(text);
      if (detected && detected.confidence > 0.5) {
        setPendingEvent({ detected, userMessage, conversationId: convId, isNewConversation });
        requestInFlightRef.current = false;
        setSavingMessage(false);
        return;
      }

      // Long-Term Memory: detect anything worth remembering and react per the
      // user's memory settings (auto-save or ask). This does NOT block sending.
      if (processMemoryDetection(text, userMessage, convId, isNewConversation)) {
        requestInFlightRef.current = false;
        setSavingMessage(false);
        return;
      }

      // Start the AI request as soon as the user message is persisted and
      // feature detections have had their chance to intercept. The conversation
      // touch and title generation are non-critical side-effects that must not
      // delay the streaming response.
      sendToAI(userMessage, convId, isNewConversation);

      touchPromise.then((touchError) => {
        if (touchError) {
          console.error(
            JSON.stringify({
              event: "supabase_update_error",
              table: "conversations",
              conversationId: convId,
              error: touchError.message,
            }),
          );
        }
      });
      // Reconcile: refresh the affected message list and the exact conversation
      // list so the real server timestamps replace the optimistic ones. We do
      // NOT blanket-invalidate other queries.
      qc.invalidateQueries({ queryKey: ["messages", dbConvId], exact: true });
      qc.invalidateQueries({ queryKey: conversationsQueryKey, exact: true });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "chat_submit_error",
          message: err instanceof Error ? err.message : "Failed to send message",
        }),
      );
      requestInFlightRef.current = false;
      setSavingMessage(false);
      // Keep the user's message visible (only server state is rolled back via a
      // targeted refetch). Surface a retry so the user can resend.
      const message = err instanceof Error ? err.message : "Failed to save this message.";
      setPersistenceError(message);
      toast.error("Couldn't save conversation.", {
        description: message,
        action: {
          label: "Retry",
          onClick: () => void submit(payload),
        },
      });
    }
  };

  const regenerateLast = async () => {
    if (requestInFlightRef.current || busy) return;
    requestInFlightRef.current = true;
    const activeConversationId = activeConversationIdRef.current;
    const lastAssistant = messages
      .slice()
      .reverse()
      .find((message) => message.role === "assistant");
    try {
      setPersistenceError(null);
      setSavingMessage(true);
      if (activeConversationId && !isOptimisticId(activeConversationId) && lastAssistant) {
        const { error: deleteError } = await supabase
          .from("messages")
          .delete()
          .eq("conversation_id", activeConversationId)
          .eq("id", lastAssistant.id);
        if (deleteError) throw deleteError;
        console.info(
          JSON.stringify({
            event: "supabase_delete_success",
            table: "messages",
            role: "assistant",
            conversationId: activeConversationId,
            messageId: lastAssistant.id,
            mode,
          }),
        );
      }
      console.info(
        JSON.stringify({
          event: "chat_stream_start",
          conversationId: activeConversationId,
          mode,
          trigger: "regenerate",
        }),
      );
      await regenerate();
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "chat_regenerate_error",
          conversationId: activeConversationId,
          message: err instanceof Error ? err.message : "Failed to regenerate response",
        }),
      );
      setPersistenceError(err instanceof Error ? err.message : "Failed to regenerate response.");
    } finally {
      requestInFlightRef.current = false;
      setSavingMessage(false);
    }
  };

  const streaming = status === "streaming" || status === "submitted";

  // `useChat.stop()` aborts the browser request immediately. Depending on when
  // the abort reaches the transport, `onFinish` is not guaranteed to run, so
  // finalize the persisted partial row here as well. The id is a real UUID
  // generated locally for the insert; a later onFinish simply performs the
  // same idempotent update.
  const stopStreaming = () => {
    const messageId = streamingMsgIdRef.current;
    stop();
    if (!messageId) return;

    void (async () => {
      await streamingWriteRef.current;
      const tag = createClientTag();
      markClientTagSent(tag);
      const { error: finalizeError } = await supabase
        .from("messages")
        .update({ streaming: false, client_tag: tag })
        .eq("id", messageId);
      if (finalizeError) {
        setPersistenceError(finalizeError.message);
        return;
      }
      streamingMsgIdRef.current = null;
      streamingConvIdRef.current = null;
      streamingContentRef.current = "";
      qc.invalidateQueries({
        queryKey: ["messages", activeConversationIdRef.current],
        exact: true,
      });
    })().catch((err: unknown) => {
      setPersistenceError(
        err instanceof Error ? err.message : "Unable to stop the response cleanly.",
      );
    });
  };

  // Defensive validation for messages array
  const safeMessages = useMemo(() => {
    if (!Array.isArray(messages)) {
      console.error("Invalid messages: not an array", messages);
      return [];
    }
    // Every mutating path reconciles by id; retain this final defensive guard so
    // a repeated event or StrictMode effect can never produce duplicate React
    // keys or duplicate rendered rows.
    const byId = new Map<string, UIMessage>();
    for (const message of messages) {
      if (message && message.id && message.role && Array.isArray(message.parts)) {
        byId.set(message.id, message);
      }
    }
    return [...byId.values()];
  }, [messages]);

  // Render messages with error boundary
  const renderMessages = () => {
    if (safeMessages.length === 0) {
      if (persistenceError || storedMessagesError) {
        return (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {persistenceError ??
              (storedMessagesError instanceof Error
                ? storedMessagesError.message
                : "Failed to load saved messages.")}
          </div>
        );
      }
      return <EmptyState onPick={(s) => setInput(s)} />;
    }

    const messagesContainErrorPart = safeMessages.some((m) =>
      m.parts.some((p) => (p as { type: string }).type === "error"),
    );

    return (
      <ul className="flex w-full flex-col gap-4">
        {safeMessages.map((m, idx) => {
          const isLast = idx === safeMessages.length - 1;
          const text = m.parts
            .filter((p) => (p as { type: string }).type === "text")
            .map((p) => (p as { text?: string }).text ?? "")
            .join("");
          const isStreaming = isLast && m.role === "assistant" && busy;
          // AI-SDK embeds backend failures as `error` parts (text is a JSON
          // `LordError`). Render them with the real, request-correlated message
          // instead of silently dropping them (which previously left the user
          // staring at a broken, empty bubble).
          const errorParts = m.parts
            .filter((p) => (p as { type: string }).type === "error")
            .map((p) => {
              const partText = (p as { errorText?: string }).errorText ?? "";
              const lordErr = parseLordError(partText);
              return lordErr
                ? formatUserFacingError(lordErr)
                : partText || "The AI request failed.";
            });
          return (
            <li
              key={m.id}
              className={cn(
                "flex min-w-0 gap-2 md:gap-3",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {m.role === "assistant" && <Avatar />}
              <div
                className={cn(
                  "min-w-0",
                  m.role === "user" ? "max-w-[90%] md:max-w-[78%]" : "max-w-[100%] md:max-w-[90%]",
                )}
              >
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap rounded-[24px] bg-primary px-3 py-2.5 text-sm leading-relaxed text-primary-foreground md:px-4">
                    {text}
                  </div>
                ) : (
                  <div className="text-sm text-foreground">
                    <RichMessage text={text} streaming={isStreaming} />
                    {errorParts.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {errorParts.map((errText, i) => (
                          <div
                            key={i}
                            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                          >
                            {errText}
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => regenerateLast()}
                                className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-destructive hover:bg-destructive/10"
                              >
                                Retry
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!isStreaming && (
                      <MessageActions
                        text={text}
                        canRegenerate={isLast && !busy}
                        onRegenerate={regenerateLast}
                      />
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {busy &&
          !(
            safeMessages.length > 0 && safeMessages[safeMessages.length - 1]?.role === "assistant"
          ) && (
            <li className="flex items-center gap-3">
              <Avatar />
              <TypingDots />
            </li>
          )}
        {error &&
          !messagesContainErrorPart &&
          (() => {
            const lordErr = parseLordError(error.message);
            const requestId = lordErr?.requestId ?? "";
            return (
              <li className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <div>
                  {lordErr
                    ? formatUserFacingError(lordErr)
                    : error.message || "The AI request failed. Please retry."}
                </div>
                {requestId && (
                  <div className="mt-1 font-mono text-destructive/80">
                    Request ID: {requestId.slice(0, 8).toUpperCase()}
                  </div>
                )}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => regenerateLast()}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-destructive hover:bg-destructive/10"
                  >
                    Retry
                  </button>
                </div>
              </li>
            );
          })()}
        {(persistenceError || storedMessagesError) && (
          <li className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {persistenceError ??
              (storedMessagesError instanceof Error
                ? storedMessagesError.message
                : "Failed to load saved messages.")}
          </li>
        )}
      </ul>
    );
  };

  return (
    <>
      <AppShell>
        <div className="flex h-[calc(100svh-9.25rem)] min-h-0 gap-3 md:h-[calc(100vh-7rem)] md:gap-4">
          {sidebarOpen && (
            <div className="hidden w-72 flex-shrink-0 lg:block">
              <FolderSidebar
                userId={user.id}
                conversationsQueryKey={conversationsQueryKey}
                conversations={conversationsWithFolder}
                currentId={conversationId}
                onSelect={loadConversation}
                onNew={handleNewChat}
                onDelete={(id) => {
                  if (busy && id === conversationId) {
                    toast.info("Stop or wait for the current response before deleting this chat.");
                    return;
                  }
                  deleteMutation.mutate(id);
                }}
                onRename={(id, title) => renameMutation.mutate({ id, title })}
                onPin={(id, pinned) => pinMutation.mutate({ id, pinned })}
                onFavorite={(id, favorite) => favoriteMutation.mutate({ id, favorite })}
                patchConversationFolder={patchConversationFolder}
              />
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-w-0 items-center gap-2 px-1 pb-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="hidden rounded-md border border-border/60 bg-background/40 p-2 text-muted-foreground transition hover:text-primary lg:block"
                aria-label="Toggle sidebar"
              >
                <LayoutPanelLeft className="h-4 w-4" />
              </button>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <h1 className="truncate text-sm font-semibold text-foreground">
                  {conversations.find((c) => c.id === conversationId)?.title || "New conversation"}
                </h1>
                <ShareButton
                  userId={user.id}
                  conversationId={conversationId}
                  conversationTitle={
                    conversations.find((c) => c.id === conversationId)?.title ?? "New conversation"
                  }
                />
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                ref={scrollerRef}
                aria-live="polite"
                className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-6"
              >
                <div className="mx-auto flex w-full max-w-[860px] flex-col">
                  <ChatErrorBoundary>{renderMessages()}</ChatErrorBoundary>
                </div>
              </div>

              {showNewMessages && (
                <button
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-primary/40 bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg transition hover:bg-primary/90"
                  aria-label="Scroll to latest messages"
                >
                  ↓ New messages
                </button>
              )}
            </div>

            {pendingEvent && (
              <EventConfirmPrompt
                detected={pendingEvent.detected}
                onConfirm={() => resolvePendingEvent(true)}
                onDecline={() => resolvePendingEvent(false)}
              />
            )}

            {pendingMemories && (
              <MemoryConfirmPrompt
                detected={pendingMemories.detected}
                onConfirm={() => resolvePendingMemories(true)}
                onDecline={() => resolvePendingMemories(false)}
              />
            )}

            <div className="shrink-0 px-3 py-3 md:px-4">
              <div className="mx-auto w-full max-w-[860px]">
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSend={submit}
                  onStop={stopStreaming}
                  streaming={streaming}
                  disabled={savingMessage}
                  mode={mode}
                  onModeChange={(m) => {
                    setMode(m);
                    emitDashboardEvent("ai");
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </AppShell>
      <Toaster />
      <ImageGenModal
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        conversationId={conversationId}
        initialPrompt={imagePrompt}
        onInsert={() => {
          setImageModalOpen(false);
          toast.success("Image generated — available in your gallery.");
        }}
      />
    </>
  );
}

function MessageActions({
  text,
  canRegenerate,
  onRegenerate,
}: {
  text: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        onClick={copy}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition",
          copied
            ? "text-[var(--hud-success)]"
            : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
        )}
        aria-label="Copy message"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      {canRegenerate && (
        <button
          onClick={onRegenerate}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
          aria-label="Regenerate response"
        >
          <RefreshCcw className="h-3 w-3" />
          Regenerate
        </button>
      )}
    </div>
  );
}

function Avatar() {
  return (
    <div
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
      style={{ background: "var(--gradient-hud)", boxShadow: "0 0 12px var(--hud)" }}
    >
      <span className="font-display text-[10px] font-bold text-background">L</span>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  const suggestions = [
    "Summarize the key ideas in Sapiens.",
    "Plan a 7-day deep work schedule.",
    "Explain async/await in TypeScript with a code example.",
    "Give me a research brief on quantum computing.",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 font-display text-lg gradient-text text-glow">Standing by.</div>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Issue a directive and I shall respond. Pick a model above to bias the active model.
      </p>
      <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-md border border-border/60 bg-background/40 p-3 text-left text-xs text-muted-foreground transition hover:border-primary/60 hover:text-primary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function EventConfirmPrompt({
  detected,
  onConfirm,
  onDecline,
}: {
  detected: DetectedEvent;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="mx-auto mt-3 w-full max-w-[860px]">
      <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Add this to your calendar?</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {detected.title}
              {detected.date ? ` · ${detected.date}` : ""}
              {detected.startTime ? ` at ${detected.startTime}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onConfirm}
              className="rounded-md bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-background transition hover:bg-cyan-300"
            >
              Yes, add
            </button>
            <button
              onClick={onDecline}
              className="rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              No
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryConfirmPrompt({
  detected,
  onConfirm,
  onDecline,
}: {
  detected: DetectedMemory[];
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="mx-auto mt-3 w-full max-w-[860px]">
      <div className="rounded-lg border border-[color:var(--hud)]/30 bg-[color:var(--hud)]/10 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {detected.length === 1
                ? "I think this is worth remembering."
                : `I think these ${detected.length} things are worth remembering.`}
            </p>
            <ul className="mt-1 space-y-1">
              {detected.map((d, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="mr-1 inline-flex rounded bg-[color:var(--hud)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--hud)]">
                    {d.category}
                  </span>
                  {d.content}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onConfirm}
              className="rounded-md bg-[color:var(--hud)] px-3 py-1.5 text-xs font-semibold text-[color:var(--background)] transition hover:opacity-90"
            >
              Remember
            </button>
            <button
              onClick={onDecline}
              className="rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
