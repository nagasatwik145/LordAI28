import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function lordFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Request failed (${res.status})`);
  }
  return json;
}

export interface StatusResponse {
  success: boolean;
  connections: Record<string, string>;
  activity: Array<{ id: string; ts: number; level: string; message: string; source?: string }>;
  tools: Array<{ name: string; category: string; risk: string }>;
  configured: { ai: boolean; esp32: boolean; screen: boolean };
}

export function useStatus() {
  return useQuery({
    queryKey: ["lord", "status"],
    queryFn: () => lordFetch<StatusResponse>("/api/lord/status"),
    refetchInterval: 4000,
  });
}

export function useToolCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { tool: string; params?: Record<string, unknown> }) =>
      lordFetch<{
        success: boolean;
        message?: string;
        data?: Record<string, unknown>;
        error?: string;
      }>("/api/lord/tool", { method: "POST", body: JSON.stringify(vars) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lord", "status"] });
      qc.invalidateQueries({ queryKey: ["lord", "activity"] });
    },
  });
}

export interface AgentResult {
  status: "completed" | "needs-confirmation" | "error";
  planId?: string;
  intent: string;
  steps: Array<{
    id: string;
    tool: string;
    params: Record<string, unknown>;
    risk: string;
    intent: string;
    status: string;
    result?: { success: boolean; message: string };
  }>;
  summary?: string;
  error?: string;
}

export function useAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { command?: string; planId?: string; approvedStepIds?: string[] | "all" }) =>
      lordFetch<AgentResult>("/api/lord/agent/execute", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lord", "status"] });
      qc.invalidateQueries({ queryKey: ["lord", "activity"] });
    },
  });
}

export function useStop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { resume?: boolean }) =>
      lordFetch<{ success: boolean; message?: string }>("/api/lord/agent/stop", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lord", "status"] });
      qc.invalidateQueries({ queryKey: ["lord", "activity"] });
    },
  });
}

export function useActivity() {
  return useQuery({
    queryKey: ["lord", "activity"],
    queryFn: () =>
      lordFetch<{ success: boolean; activity: StatusResponse["activity"] }>("/api/lord/activity"),
    refetchInterval: 4000,
  });
}
