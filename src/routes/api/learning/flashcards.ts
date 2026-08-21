/* eslint-disable @typescript-eslint/no-explicit-any -- server context receives the migration-defined database client. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse } from "@/lib/api-error";
import { OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter-provider";

const FlashcardRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    conceptId: z.string().min(1),
    count: z.number().int().min(1).max(20).default(8),
    sourceText: z.string().optional(),
  }),
  z.object({
    action: z.literal("review"),
    flashcardId: z.string().uuid(),
    quality: z.number().int().min(0).max(5),
    responseTimeMs: z.number().int().optional(),
  }),
  z.object({
    action: z.literal("due"),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.object({
    action: z.literal("list"),
    conceptId: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
]);

function getOpenRouterProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("AI not configured");
  return createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  });
}

export const Route = createFileRoute("/api/learning/flashcards")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const parsed = FlashcardRequestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return apiErrorResponse(400, "INVALID_REQUEST", "Invalid flashcard request.", requestId);

        const auth = context as { userId?: string; supabase?: { from: (table: string) => any } };
        if (!auth.userId || !auth.supabase)
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to use learning tools.",
            requestId,
          );

        const db = auth.supabase;
        const userId = auth.userId;

        try {
          if (parsed.data.action === "generate") {
            const { data: concept } = await db
              .from("learning_concepts")
              .select("*")
              .eq("id", parsed.data.conceptId)
              .maybeSingle();
            if (!concept)
              return apiErrorResponse(404, "NOT_FOUND", "Concept not found.", requestId);

            const { data: mastery } = await db
              .from("learning_mastery")
              .select("*")
              .eq("user_id", userId)
              .eq("concept_id", concept.id)
              .maybeSingle();

            const provider = getOpenRouterProvider();
            const diffLabels = [
              "",
              "introductory",
              "foundational",
              "standard",
              "advanced",
              "mastery",
            ];
            const difficulty = mastery ? Math.ceil((1 - (mastery.score ?? 0.35)) * 5) : 3;
            const diffLabel = diffLabels[difficulty] ?? "standard";

            let sourceContext = "";
            if (parsed.data.sourceText) {
              sourceContext = `\nSource material:\n${parsed.data.sourceText.slice(0, 10000)}`;
            }

            const { text } = await generateText({
              model: provider(OPENROUTER_DEFAULT_MODEL),
              system: `You are a ${diffLabel}-level ${concept.framework} flashcard creator. Output ONLY strict JSON array. No markdown. No extra text.`,
              messages: [
                {
                  role: "user",
                  content: `Create ${parsed.data.count} flashcards for: "${concept.title}" (${concept.description}).
Grade: ${concept.grade_band}, Curriculum: ${concept.framework}, Difficulty: ${diffLabel}.${sourceContext}
Front: concise question. Back: one-line answer. Tags: relevant keywords.
Format: [{"front":"...","back":"...","tags":[]}]`,
                },
              ],
              maxOutputTokens: 2000,
              temperature: 0.5,
            });

            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch)
              return apiErrorResponse(500, "AI_ERROR", "Failed to generate flashcards.", requestId);

            const cards = JSON.parse(jsonMatch[0]);
            const savedCards = [];

            for (const card of cards) {
              const { data, error } = await db
                .from("learning_flashcards")
                .insert({
                  user_id: userId,
                  concept_id: concept.id,
                  front: card.front,
                  back: card.back,
                  tags: card.tags || [],
                  source_type: "ai-generated",
                  ai_generated: true,
                })
                .select()
                .single();
              if (!error && data) savedCards.push(data);
            }

            // Initialize SM-2 reviews
            for (const card of savedCards) {
              await db.from("learning_flashcard_reviews").insert({
                user_id: userId,
                flashcard_id: card.id,
                quality: 0,
                ease_factor: 2.5,
                interval_days: 0,
                repetitions: 0,
                next_review_at: new Date().toISOString(),
              });
            }

            return Response.json({ cards: savedCards, count: savedCards.length });
          }

          if (parsed.data.action === "review") {
            const { data: review } = await db
              .from("learning_flashcard_reviews")
              .select("*")
              .eq("id", parsed.data.flashcardId)
              .eq("user_id", userId)
              .maybeSingle();
            if (!review)
              return apiErrorResponse(404, "NOT_FOUND", "Flashcard review not found.", requestId);

            // SM-2 Algorithm
            const quality = parsed.data.quality;
            let { ease_factor, interval_days, repetitions } = review;

            if (quality >= 3) {
              if (repetitions === 0) interval_days = 1;
              else if (repetitions === 1) interval_days = 6;
              else interval_days = Math.round(interval_days * ease_factor);
              repetitions += 1;
            } else {
              repetitions = 0;
              interval_days = 1;
            }

            ease_factor = Math.max(
              1.3,
              ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
            );

            const nextReview = new Date(Date.now() + interval_days * 86400000).toISOString();

            const { data, error } = await db
              .from("learning_flashcard_reviews")
              .update({
                quality,
                ease_factor,
                interval_days,
                repetitions,
                next_review_at: nextReview,
                reviewed_at: new Date().toISOString(),
                response_time_ms: parsed.data.responseTimeMs,
              })
              .eq("id", parsed.data.flashcardId)
              .eq("user_id", userId)
              .select()
              .single();

            if (error) throw error;

            // Update mastery based on flashcard review
            const { data: card } = await db
              .from("learning_flashcards")
              .select("concept_id")
              .eq("id", review.flashcard_id)
              .maybeSingle();

            if (card?.concept_id) {
              const { data: mastery } = await db
                .from("learning_mastery")
                .select("*")
                .eq("user_id", userId)
                .eq("concept_id", card.concept_id)
                .maybeSingle();

              const correct = quality >= 3;
              const { nextMastery } = await import("@/lib/learning/mastery");
              const update = nextMastery(
                mastery as { score: number; confidence: number; evidence_count: number } | null,
                correct,
              );

              await db
                .from("learning_mastery")
                .upsert(
                  { user_id: userId, concept_id: card.concept_id, ...update },
                  { onConflict: "user_id,concept_id" },
                );
            }

            return Response.json({ review: data });
          }

          if (parsed.data.action === "due") {
            const { data, error } = await db
              .from("learning_flashcard_reviews")
              .select("*, learning_flashcards(*)")
              .eq("user_id", userId)
              .lte("next_review_at", new Date().toISOString())
              .order("next_review_at")
              .limit(parsed.data.limit);

            if (error) throw error;
            return Response.json({ cards: data ?? [] });
          }

          if (parsed.data.action === "list") {
            let query = db
              .from("learning_flashcards")
              .select("*, learning_flashcard_reviews(*)")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(parsed.data.limit);

            if (parsed.data.conceptId) {
              query = query.eq("concept_id", parsed.data.conceptId);
            }

            const { data, error } = await query;
            if (error) throw error;
            return Response.json({ cards: data ?? [] });
          }

          return apiErrorResponse(400, "INVALID_ACTION", "Unknown action.", requestId);
        } catch (err) {
          console.error("Flashcard error:", err);
          return apiErrorResponse(
            500,
            "INTERNAL_ERROR",
            "Flashcard service unavailable.",
            requestId,
          );
        }
      },
    },
  },
});
