import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, MessageSquare, Bot, User, Copy, Check, Brain, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { streamChat } from "@/lib/study-chat";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  createTutorSession,
  getLatestTutorSession,
  getSessionMessages,
  saveTutorMessage,
  listTutorSessions,
  searchTutorSessions,
  renameTutorSession,
  deleteTutorSession,
  recordAttempt,
} from "@/lib/learning/client";
import { StudyHeader } from "../StudyHeader";
import { selectNextConcept } from "@/lib/learning/mastery";
import { generateChatTitle, shouldGenerateTitle } from "@/lib/chat-title";
import { generateConversationTitle } from "@/lib/title-service";
import { detectTopic } from "@/lib/learning/brain";
import type { LearningSnapshot, StudyView, TutorMode } from "../types";
import type { TutorSessionRow, LearningSession } from "@/lib/learning/types";
import { TutorSidebar } from "../TutorSidebar";

interface TutorViewProps {
  snapshot: LearningSnapshot | undefined;
  userId: string | null;
  conceptId?: string;
  onNavigate: (view: StudyView) => void;
  onBack: () => void;
  refresh: () => void;
}

type TutorMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const TUTOR_MODES: TutorMode[] = [
  "socratic",
  "direct",
  "hint",
  "worked_example",
  "simplified",
  "analogy",
  "diagnostic",
];

const MODE_LABELS: Record<TutorMode, string> = {
  socratic: "Socratic (Guided)",
  direct: "Direct Answer",
  hint: "Hint Focus",
  worked_example: "Worked Example",
  simplified: "Simplified",
  analogy: "Analogy Mode",
  diagnostic: "Diagnostic",
};

const SUGGESTED_PROMPTS = [
  "Explain photosynthesis step by step",
  "What's the difference between weather and climate?",
  "Give me a hint for solving quadratic equations",
  "Show me a worked example of Newton's second law",
];

const MASTERY_KEYWORDS: Record<TutorMode, RegExp> = {
  socratic: /\b(why|how do (you|i) know|reason|explain)\b/i,
  direct: /\b(answer|solve|just tell|what is the (result|solution))\b/i,
  hint: /\b(hint|clue|help me start|get started|stuck)\b/i,
  worked_example: /\b(example|show me|worked|demonstrate)\b/i,
  simplified: /\b(simple|simplify|explain simply|easy|basic)\b/i,
  analogy: /\b(like|analogy|compare|similar to|metaphor)\b/i,
  diagnostic: /\b(diagnose|wrong|error|don't understand|confused|mistake)\b/i,
};

function detectOptimalMode(text: string): TutorMode {
  let best: TutorMode = "socratic";
  let bestScore = 0;
  for (const mode of TUTOR_MODES) {
    const match = text.match(MASTERY_KEYWORDS[mode]);
    if (match && match[0].length > bestScore) {
      best = mode;
      bestScore = match[0].length;
    }
  }
  return best;
}

type MasterySignal = {
  kind: "confidence" | "struggle" | "neutral";
  text: string;
};

function analyzeMasterySignal(text: string): MasterySignal | null {
  const struggle = /\b(don't understand|confused|wrong|error|stuck|help|hint)\b/i.test(text);
  const confidence = /\b(i get it|i understand|got it|makes sense|easy|simple)\b/i.test(text);
  if (struggle) return { kind: "struggle", text };
  if (confidence) return { kind: "confidence", text };
  return null;
}

const EMPTY_SESSIONS: ReturnType<typeof listTutorSessions> extends Promise<infer T> ? T : never =
  [] as never;

export function TutorView({ snapshot, userId, conceptId, onBack }: TutorViewProps) {
  const { user } = useCurrentUser();
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [tutorMode, setTutorMode] = useState<TutorMode>("socratic");
  const [adaptiveMode, setAdaptiveMode] = useState<TutorMode | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TutorSessionRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const titleGeneratedForRef = useRef<string | null>(null);
  const masteryUpdateQueueRef = useRef<MasterySignal[]>([]);

  const activeConcept = conceptId
    ? snapshot?.concepts.find((c) => c.id === conceptId)
    : (selectNextConcept(snapshot?.concepts ?? [], snapshot?.mastery ?? []) ?? undefined);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;
    let cancelled = false;

    async function loadSessions() {
      setIsLoadingSessions(true);
      try {
        const all = await listTutorSessions(uid);
        if (cancelled) return;
        setSessions(all);

        if (activeConcept) {
          const latest = all.find((s) => s.concept_id === activeConcept.id);
          if (latest && !sessionId) {
            setSessionId(latest.id);
            setIsLoadingMessages(true);
            const saved = await getSessionMessages(uid, latest.id);
            if (!cancelled) {
              if (saved.length) {
                setMessages(
                  saved.map((msg) => ({
                    id: msg.id,
                    role: msg.role === "assistant" ? "assistant" : "user",
                    text: msg.content,
                  })),
                );
              } else {
                setMessages([
                  {
                    id: "welcome",
                    role: "assistant",
                    text: `Hi — I'm LORD, your AI learning coach. I'm here to help you understand ${
                      activeConcept?.subject ?? "your subject"
                    }. What would you like to learn about?`,
                  },
                ]);
              }
              setIsLoadingMessages(false);
            }
          } else if (!latest && !sessionId) {
            setMessages([
              {
                id: "welcome",
                role: "assistant",
                text: `Hi — I'm LORD, your AI learning coach. I'm here to help you understand ${
                  activeConcept?.subject ?? "your subject"
                }. What would you like to learn about?`,
              },
            ]);
          }
        } else if (!sessionId) {
          setMessages([
            {
              id: "welcome",
              role: "assistant",
              text: "Hi — I'm LORD, your AI learning coach. Pick a subject to start tutoring.",
            },
          ]);
        }
      } catch {
        if (!cancelled) {
          setIsLoadingSessions(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSessions(false);
        }
      }
    }

    loadSessions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, conceptId, activeConcept?.id]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (!user?.id) return;
      setSessionId(id);
      setIsLoadingMessages(true);
      try {
        const saved = await getSessionMessages(user.id, id);
        if (saved.length) {
          setMessages(
            saved.map((msg) => ({
              id: msg.id,
              role: msg.role === "assistant" ? "assistant" : "user",
              text: msg.content,
            })),
          );
        } else {
          setMessages([
            {
              id: "welcome",
              role: "assistant",
              text: activeConcept
                ? `Hi — I'm LORD, your AI learning coach. I'm here to help you understand ${
                    activeConcept.subject ?? "your subject"
                  }. What would you like to learn about?`
                : "Hi — I'm LORD, your AI learning coach. Pick a subject to start tutoring.",
            },
          ]);
        }
      } catch {
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            text: "Unable to load messages. Please try again.",
          },
        ]);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [user?.id, activeConcept],
  );

  const handleNewChat = useCallback(() => {
    setSessionId(null);
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: activeConcept
          ? `Hi — I'm LORD, your AI learning coach. I'm here to help you understand ${
              activeConcept.subject ?? "your subject"
            }. What would you like to learn about?`
          : "Hi — I'm LORD, your AI learning coach. Pick a subject to start tutoring.",
      },
    ]);
  }, [activeConcept]);

  const handleRename = useCallback(
    async (id: string, title: string) => {
      if (!user?.id) return;
      await renameTutorSession(user.id, id, title);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    },
    [user?.id],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!user?.id) return;
      if (sessionId === id) {
        setSessionId(null);
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            text: activeConcept
              ? `Hi — I'm LORD, your AI learning coach. I'm here to help you understand ${
                  activeConcept.subject ?? "your subject"
                }. What would you like to learn about?`
              : "Hi — I'm LORD, your AI learning coach. Pick a subject to start tutoring.",
          },
        ]);
      }
      await deleteTutorSession(user.id, id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    },
    [user?.id, sessionId, activeConcept],
  );

  const handleSearch = useCallback(
    async (query: string) => {
      if (!user?.id) return;
      setSearchQuery(query);
      if (!query.trim()) {
        const all = await listTutorSessions(user.id);
        setSessions(all);
        return;
      }
      const results = await searchTutorSessions(user.id, query.trim());
      setSessions(results);
    },
    [user?.id],
  );

  const sendMessage = useCallback(async () => {
    if (!draft.trim() || isThinking || !user?.id) return;

    const text = draft.trim();
    const userMessage: TutorMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setIsThinking(true);

    const optimalMode = detectOptimalMode(text);
    if (optimalMode !== tutorMode) {
      setAdaptiveMode(optimalMode);
    }

    let persistedSessionId = sessionId;

    if (!persistedSessionId) {
      try {
        const newSessionId = await createTutorSession(
          user.id,
          activeConcept?.id ?? null,
          activeConcept ? `Learning ${activeConcept.title}` : "Tutor Chat",
          activeConcept?.subject ?? null,
          activeConcept?.title ?? null,
        );
        persistedSessionId = newSessionId;
        setSessionId(newSessionId);
        setSessions((prev) => {
          const existing = prev.find((s) => s.id === newSessionId);
          if (existing) return prev;
          return [
            {
              id: newSessionId,
              concept_id: activeConcept?.id ?? null,
              title: activeConcept ? `Learning ${activeConcept.title}` : "Tutor Chat",
              status: "active",
              subject: activeConcept?.subject ?? null,
              topic: activeConcept?.title ?? null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as LearningSession,
            ...prev,
          ];
        });
      } catch {
        setIsThinking(false);
        return;
      }
    }

    if (persistedSessionId) {
      void saveTutorMessage(user.id, persistedSessionId, "user", text).catch(() => undefined);
    }

    const sourceContext = snapshot?.sources
      .filter((s) => s.extracted_text?.trim())
      .slice(0, 2)
      .map((s) => `[${s.name}] ${s.extracted_text!.slice(0, 2500)}`)
      .join("\n\n");

    const studentClass = snapshot?.profile?.class ?? null;
    const customTag = activeConcept?.is_custom
      ? "\nThis concept is a student-created custom concept (not part of the standard curriculum)."
      : "";

    const conversationHistory = messages.slice(-8).map((msg) => ({
      role: msg.role,
      content: msg.text,
    }));

    const systemPrompt = [
      `You are LORD, a safe and encouraging middle/high-school tutor.`,
      studentClass ? `Student class: ${studentClass}.` : "",
      `Subject: ${activeConcept?.subject ?? "General"}.`,
      `Current concept: ${activeConcept?.title ?? "any topic"} - ${activeConcept?.description ?? ""}.`,
      customTag,
      `Teaching mode: ${MODE_LABELS[adaptiveMode ?? tutorMode]} - Guide the student with questions and hints before revealing answers.`,
      `Guidelines: Use short, clear chunks. Offer a hint, concrete example, and a one-question understanding check. Label worked examples as AI-generated.`,
      sourceContext
        ? `PRIVATE STUDENT MATERIALS:\n${sourceContext}`
        : "No private study material selected for this answer.",
      conversationHistory.length > 0
        ? `RECENT CONVERSATION:\n${conversationHistory.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}`
        : "",
      `Student message: ${text}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", text: "" }]);

    try {
      const answer = await streamChat(
        {
          mode: "reasoning",
          context: {
            page: "study",
            workflow: "tutor",
            conceptId: activeConcept?.id,
          },
          messages: [
            {
              id: userMessage.id,
              role: "user",
              parts: [{ type: "text", text: systemPrompt }],
            },
          ],
        },
        (acc) => {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === assistantId ? { ...msg, text: acc } : msg)),
          );
        },
      );

      if (answer.trim() && persistedSessionId) {
        void saveTutorMessage(user.id, persistedSessionId, "assistant", answer).catch(
          () => undefined,
        );
        setSessions((prev) =>
          prev.map((s) =>
            s.id === persistedSessionId ? { ...s, updated_at: new Date().toISOString() } : s,
          ),
        );

        const masterySignal = analyzeMasterySignal(text);
        if (masterySignal && activeConcept) {
          masteryUpdateQueueRef.current.push(masterySignal);
        }

        const currentSession = sessions.find((s) => s.id === persistedSessionId);
        if (
          currentSession &&
          shouldGenerateTitle(currentSession.title) &&
          !titleGeneratedForRef.current
        ) {
          titleGeneratedForRef.current = persistedSessionId;
          generateConversationTitle(text, persistedSessionId)
            .then((generated) => {
              if (generated) {
                void renameTutorSession(user.id, persistedSessionId, generated).catch(() => {
                  titleGeneratedForRef.current = null;
                });
                setSessions((prev) =>
                  prev.map((s) => (s.id === persistedSessionId ? { ...s, title: generated } : s)),
                );
              }
            })
            .catch(() => {
              titleGeneratedForRef.current = null;
            });
        }

        const allMessages = [
          ...messages.map((m) => ({ role: m.role, content: m.text })),
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: answer },
        ];
        if (persistedSessionId && allMessages.length >= 4) {
          void (async () => {
            try {
              const response = await fetch(
                `${import.meta.env.VITE_API_BASE_URL || ""}/api/learning/session`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "memory_extract",
                    sessionId: persistedSessionId,
                    messages: allMessages
                      .slice(-10)
                      .map((m) => ({ role: m.role, content: m.content })),
                  }),
                },
              );
              if (response.ok) {
                const data = await response.json();
                if (data.memories?.length > 0) {
                  console.log(`[Tutor] Extracted ${data.memories.length} memories`);
                }
              }
            } catch {
              // memory extraction is non-critical
            }
          })();
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, text: "I'm unable to respond right now. Please try again in a moment." }
            : msg,
        ),
      );
    } finally {
      setIsThinking(false);
    }
  }, [
    draft,
    isThinking,
    messages,
    tutorMode,
    sessionId,
    activeConcept,
    user?.id,
    snapshot?.sources,
    snapshot?.profile?.class,
    sessions,
  ]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!snapshot || !user) {
    return (
      <div className="p-6">
        <StudyHeader
          view="tutor"
          title="AI Tutor"
          onBack={onBack}
          showBack
          icon={<MessageSquare className="h-6 w-6 text-primary" />}
        />
      </div>
    );
  }

  const currentSession = sessions.find((s) => s.id === sessionId);
  const sessionTitle = currentSession?.title ?? "New tutor chat";

  return (
    <div className="p-6">
      <StudyHeader
        view="tutor"
        title="LORD AI Tutor"
        subtitle={
          activeConcept ? `${activeConcept.title} · ${activeConcept.subject}` : "Adaptive tutoring"
        }
        icon={<MessageSquare className="h-6 w-6 text-primary" />}
        onBack={onBack}
        showBack
        action={
          <select
            value={tutorMode}
            onChange={(e) => setTutorMode(e.target.value as TutorMode)}
            className="rounded-md border border-border/40 bg-background/60 px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
          >
            {TUTOR_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        }
      />

      <div className="flex gap-4">
        <TutorSidebar
          sessions={sessions}
          currentId={sessionId}
          onSelect={handleSelectSession}
          onNew={handleNewChat}
          onDelete={handleDelete}
          onRename={handleRename}
          isOpen={true}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="truncate text-sm font-semibold text-foreground">{sessionTitle}</h2>
          </div>

          <div className="hud-panel flex h-[500px] flex-col p-4">
            <div className="flex-1 space-y-4 overflow-y-auto px-1">
              {isLoadingMessages ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Loading messages…
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className={cn(
                        "flex gap-3",
                        msg.role === "user" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "border border-border/40 bg-muted/20 text-foreground",
                        )}
                      >
                        <div className="space-y-2">
                          {msg.text.split("\n").map((line, i) => (
                            <p key={i} className="whitespace-pre-wrap">
                              {line || "\u00A0"}
                            </p>
                          ))}
                        </div>

                        {msg.role === "assistant" && msg.text && (
                          <button
                            onClick={() => handleCopy(msg.text, msg.id)}
                            className="mt-2 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground"
                          >
                            {copiedId === msg.id ? (
                              <Check className="h-3 w-3 inline" />
                            ) : (
                              <Copy className="h-3 w-3 inline" />
                            )}
                          </button>
                        )}
                      </div>

                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                        {msg.role === "user" ? (
                          <User className="h-4 w-4 text-primary" />
                        ) : (
                          <Bot className="h-4 w-4 text-cyan-300" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}

              {isThinking && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 justify-start"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                    <Bot className="h-4 w-4 text-cyan-300" />
                  </div>
                  <div className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-3">
                    <div className="flex gap-1">
                      <motion.span
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      >
                        .
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                      >
                        .
                      </motion.span>
                      <motion.span
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                      >
                        .
                      </motion.span>
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-border/40 pt-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <motion.button
                    key={prompt}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setDraft(prompt)}
                    disabled={isThinking}
                    className="rounded-full border border-border/30 bg-background/40 px-3 py-1 text-xs text-muted-foreground hover:border-primary/30 hover:text-primary disabled:opacity-50"
                  >
                    {prompt}
                  </motion.button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMessage();
                }}
                className="flex gap-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Ask about a topic, show your thinking, or paste a problem…"
                  className="flex-1 rounded-lg border border-border/40 bg-background/60 px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground/50 focus:border-primary/50 focus:outline-none"
                  disabled={isThinking}
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  disabled={isThinking || !draft.trim()}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg text-primary-foreground transition-all",
                    isThinking || !draft.trim()
                      ? "cursor-not-allowed bg-muted/40"
                      : "bg-primary shadow hover:bg-primary/90",
                  )}
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </motion.button>
              </form>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="mt-3 text-center text-xs text-muted-foreground/60"
          >
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
              {isThinking
                ? "LORD is thinking…"
                : "AI-generated tutoring. Check against course materials."}
            </span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
