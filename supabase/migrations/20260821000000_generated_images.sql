ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image'));
CREATE TABLE public.generated_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  prompt text NOT NULL,
  revised_prompt text,
  negative_prompt text,
  model text NOT NULL,
  provider text NOT NULL,
  width integer NOT NULL CHECK (width BETWEEN 256 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 256 AND 4096),
  seed bigint,
  image_url text NOT NULL,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generated_images_user_created_idx ON public.generated_images(user_id, created_at DESC);
CREATE INDEX generated_images_project_idx ON public.generated_images(project_id, created_at DESC);
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their generated images" ON public.generated_images FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.generated_images;
