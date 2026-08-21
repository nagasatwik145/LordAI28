export interface ModelDef {
  id: string;
  label: string;
  provider: string;
}

import { MODEL_REGISTRY, DEFAULT_MODEL_ID } from "@/lib/model-registry";

export const MODELS: ModelDef[] = MODEL_REGISTRY.filter((m) => m.supports.includes("chat")).map(
  (m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
  }),
);

export { DEFAULT_MODEL_ID };

export function getModelDef(id: string): ModelDef {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
