ALTER TABLE public.generated_images
  ADD COLUMN IF NOT EXISTS aspect_ratio text,
  ADD COLUMN IF NOT EXISTS queue_time_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generation_time_ms integer,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(12,6),
  ADD COLUMN IF NOT EXISTS success boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_image_id uuid REFERENCES public.generated_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_instruction text;
CREATE INDEX IF NOT EXISTS generated_images_analytics_idx ON public.generated_images(user_id, model, created_at DESC);
