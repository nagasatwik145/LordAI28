import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  FileText,
  BookOpen,
  Brain,
  ListTodo,
  Lightbulb,
  HardDrive,
  Zap,
  TrendingUp,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardStats } from "@/lib/phase2/types";

const statCards = [
  {
    key: "totalConversations",
    label: "Conversations",
    icon: MessageSquare,
    color: "text-blue-400",
  },
  { key: "totalMessages", label: "Messages", icon: MessageSquare, color: "text-green-400" },
  { key: "totalArtifacts", label: "Artifacts", icon: FileText, color: "text-purple-400" },
  { key: "totalKnowledgeSources", label: "Knowledge", icon: BookOpen, color: "text-orange-400" },
  { key: "totalMemories", label: "Memories", icon: Brain, color: "text-pink-400" },
  { key: "totalTasks", label: "Tasks", icon: ListTodo, color: "text-yellow-400" },
  { key: "totalNotes", label: "Notes", icon: Lightbulb, color: "text-cyan-400" },
  { key: "totalFiles", label: "Files", icon: HardDrive, color: "text-indigo-400" },
] as const;

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async (): Promise<DashboardStats> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Unauthorized");

      const [
        conversationsRes,
        messagesRes,
        artifactsRes,
        knowledgeRes,
        memoriesRes,
        tasksRes,
        notesRes,
        filesRes,
        activityRes,
      ] = await Promise.all([
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("role", "user")
          .eq("user_id", user.id),
        supabase
          .from("canvas_artifacts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_archived", false),
        supabase
          .from("knowledge_sources")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("memories")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("archived", false),
        supabase
          .from("project_tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("project_notes")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_archived", false),
        supabase
          .from("files")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_archived", false),
        supabase
          .from("project_activity")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      return {
        totalConversations: conversationsRes.count ?? 0,
        totalMessages: messagesRes.count ?? 0,
        totalArtifacts: artifactsRes.count ?? 0,
        totalKnowledgeSources: knowledgeRes.count ?? 0,
        totalMemories: memoriesRes.count ?? 0,
        totalTasks: tasksRes.count ?? 0,
        totalNotes: notesRes.count ?? 0,
        totalFiles: filesRes.count ?? 0,
        recentActivity: (activityRes.data ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          action: a.action as string,
          entityType: a.entity_type as string,
          entityId: a.entity_id as string,
          createdAt: a.created_at as string,
          metadata: (a.metadata as Record<string, unknown>) ?? {},
        })) as DashboardStats["recentActivity"],
        tokenUsageToday: 0,
        tokenUsageThisWeek: 0,
        modelUsageBreakdown: {},
      } as DashboardStats;
    },
  });
}

export function StatCard({
  title,
  value,
  icon: Icon,
  color,
  trend,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  trend?: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn("h-4 w-4", color)} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        {trend !== undefined && (
          <p className={cn("text-xs mt-1", trend >= 0 ? "text-green-400" : "text-red-400")}>
            {trend >= 0 ? "+" : ""}
            {trend}% from last week
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardGrid({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {statCards.map((card) => (
        <StatCard
          key={card.key}
          title={card.label}
          value={(stats as unknown as Record<string, number>)[card.key] ?? 0}
          icon={card.icon}
          color={card.color}
        />
      ))}
    </div>
  );
}

export function ActivityFeed({ activities }: { activities: DashboardStats["recentActivity"] }) {
  if (activities.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No recent activity</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3">
              <div className="mt-0.5">
                <Badge variant="secondary" className="text-[10px]">
                  {activity.entityType}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{activity.action}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(activity.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
