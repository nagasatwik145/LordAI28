export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      canvas_artifacts: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          title: string;
          type: string;
          content: string;
          metadata: Json;
          version: number;
          parent_version_id: string | null;
          is_archived: boolean;
          is_shared: boolean;
          share_token: string | null;
          language: string | null;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id?: string | null;
          title?: string;
          type?: string;
          content?: string;
          metadata?: Json;
          version?: number;
          parent_version_id?: string | null;
          is_archived?: boolean;
          is_shared?: boolean;
          share_token?: string | null;
          language?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          project_id?: string | null;
          title?: string;
          type?: string;
          content?: string;
          metadata?: Json;
          version?: number;
          parent_version_id?: string | null;
          is_archived?: boolean;
          is_shared?: boolean;
          share_token?: string | null;
          language?: string | null;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      canvas_artifact_versions: {
        Row: {
          id: string;
          artifact_id: string;
          content: string;
          metadata: Json;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          artifact_id: string;
          content: string;
          metadata?: Json;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          artifact_id?: string;
          content?: string;
          metadata?: Json;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          name: string;
          path: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          thumbnail_path: string | null;
          is_pinned: boolean;
          is_archived: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id?: string | null;
          name: string;
          path?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path: string;
          thumbnail_path?: string | null;
          is_pinned?: boolean;
          is_archived?: boolean;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          project_id?: string | null;
          name?: string;
          path?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          thumbnail_path?: string | null;
          is_pinned?: boolean;
          is_archived?: boolean;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_clusters: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          entity_ids: string[];
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          entity_ids?: string[];
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          entity_ids?: string[];
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_entities: {
        Row: {
          id: string;
          user_id: string;
          source_id: string | null;
          type: string;
          name: string;
          description: string | null;
          embedding: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_id?: string | null;
          type?: string;
          name: string;
          description?: string | null;
          embedding?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_id?: string | null;
          type?: string;
          name?: string;
          description?: string | null;
          embedding?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      knowledge_relations: {
        Row: {
          id: string;
          user_id: string;
          source_entity_id: string;
          target_entity_id: string;
          relation_type: string;
          confidence: number;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_entity_id: string;
          target_entity_id: string;
          relation_type: string;
          confidence?: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_entity_id?: string;
          target_entity_id?: string;
          relation_type?: string;
          confidence?: number;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      calendar_events: {
        Row: {
          category: string;
          color: string | null;
          completed: boolean;
          created_at: string;
          created_by: string;
          date: string;
          description: string | null;
          end_time: string | null;
          id: string;
          location: string | null;
          notes: string | null;
          priority: string;
          recurrence: string;
          reminder: string | null;
          start_time: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          category?: string;
          color?: string | null;
          completed?: boolean;
          created_at?: string;
          created_by?: string;
          date: string;
          description?: string | null;
          end_time?: string | null;
          id?: string;
          location?: string | null;
          notes?: string | null;
          priority?: string;
          recurrence?: string;
          reminder?: string | null;
          start_time?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          category?: string;
          color?: string | null;
          completed?: boolean;
          created_at?: string;
          created_by?: string;
          date?: string;
          description?: string | null;
          end_time?: string | null;
          id?: string;
          location?: string | null;
          notes?: string | null;
          priority?: string;
          recurrence?: string;
          reminder?: string | null;
          start_time?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      conversation_shares: {
        Row: {
          conversation_id: string;
          created_at: string;
          created_by: string;
          expires_at: string | null;
          id: string;
          is_public: boolean;
          share_token: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          created_by: string;
          expires_at?: string | null;
          id?: string;
          is_public?: boolean;
          share_token?: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          created_by?: string;
          expires_at?: string | null;
          id?: string;
          is_public?: boolean;
          share_token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_shares_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: true;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          archived: boolean | null;
          client_tag: string | null;
          created_at: string;
          deleted_at: string | null;
          favorite: boolean;
          folder_id: string | null;
          id: string;
          last_message_at: string | null;
          metadata: Json;
          pinned: boolean;
          pinned_at: string | null;
          project_id: string | null;
          sort_order: number | null;
          title: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          archived?: boolean | null;
          client_tag?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          favorite?: boolean;
          folder_id?: string | null;
          id?: string;
          last_message_at?: string | null;
          metadata?: Json;
          pinned?: boolean;
          pinned_at?: string | null;
          project_id?: string | null;
          sort_order?: number | null;
          title?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          archived?: boolean | null;
          client_tag?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          favorite?: boolean;
          folder_id?: string | null;
          id?: string;
          last_message_at?: string | null;
          metadata?: Json;
          pinned?: boolean;
          pinned_at?: string | null;
          project_id?: string | null;
          sort_order?: number | null;
          title?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      folders: {
        Row: {
          color: string | null;
          created_at: string;
          icon: string | null;
          id: string;
          name: string;
          parent_id: string | null;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          icon?: string | null;
          id?: string;
          name: string;
          parent_id?: string | null;
          sort_order?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          icon?: string | null;
          id?: string;
          name?: string;
          parent_id?: string | null;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      group_invites: {
        Row: {
          created_at: string;
          email: string;
          expires_at: string | null;
          group_id: string;
          id: string;
          invited_by: string;
          responded_at: string | null;
          status: string;
          token: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          expires_at?: string | null;
          group_id: string;
          id?: string;
          invited_by: string;
          responded_at?: string | null;
          status?: string;
          token: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          expires_at?: string | null;
          group_id?: string;
          id?: string;
          invited_by?: string;
          responded_at?: string | null;
          status?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_invites_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_members: {
        Row: {
          group_id: string;
          id: string;
          is_typing: boolean | null;
          joined_at: string;
          last_seen_at: string | null;
          last_typing_at: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          group_id: string;
          id?: string;
          is_typing?: boolean | null;
          joined_at?: string;
          last_seen_at?: string | null;
          last_typing_at?: string | null;
          role?: string;
          user_id: string;
        };
        Update: {
          group_id?: string;
          id?: string;
          is_typing?: boolean | null;
          joined_at?: string;
          last_seen_at?: string | null;
          last_typing_at?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_mentions: {
        Row: {
          id: string;
          is_read: boolean | null;
          mentioned_at: string;
          message_id: string;
          read_at: string | null;
          user_id: string;
        };
        Insert: {
          id?: string;
          is_read?: boolean | null;
          mentioned_at?: string;
          message_id: string;
          read_at?: string | null;
          user_id: string;
        };
        Update: {
          id?: string;
          is_read?: boolean | null;
          mentioned_at?: string;
          message_id?: string;
          read_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_mentions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "group_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_mentions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_message_attachments: {
        Row: {
          created_at: string;
          file_name: string;
          file_path: string;
          file_size: number;
          file_type: string;
          id: string;
          message_id: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          file_path: string;
          file_size: number;
          file_type: string;
          id?: string;
          message_id: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          file_name?: string;
          file_path?: string;
          file_size?: number;
          file_type?: string;
          id?: string;
          message_id?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "group_message_attachments_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "group_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_message_attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_message_reactions: {
        Row: {
          created_at: string;
          emoji: string;
          id: string;
          message_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emoji: string;
          id?: string;
          message_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          id?: string;
          message_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_message_reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "group_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_message_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_messages: {
        Row: {
          content: string;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          group_id: string;
          id: string;
          is_deleted: boolean | null;
          is_edited: boolean | null;
          model: string | null;
          reply_to_id: string | null;
          role: string;
          user_id: string | null;
        };
        Insert: {
          content: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          group_id: string;
          id?: string;
          is_deleted?: boolean | null;
          is_edited?: boolean | null;
          model?: string | null;
          reply_to_id?: string | null;
          role?: string;
          user_id?: string | null;
        };
        Update: {
          content?: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          group_id?: string;
          id?: string;
          is_deleted?: boolean | null;
          is_edited?: boolean | null;
          model?: string | null;
          reply_to_id?: string | null;
          role?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_messages_reply_to_id_fkey";
            columns: ["reply_to_id"];
            isOneToOne: false;
            referencedRelation: "group_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_pinned_messages: {
        Row: {
          group_id: string;
          id: string;
          message_id: string;
          pinned_at: string;
          pinned_by: string;
        };
        Insert: {
          group_id: string;
          id?: string;
          message_id: string;
          pinned_at?: string;
          pinned_by: string;
        };
        Update: {
          group_id?: string;
          id?: string;
          message_id?: string;
          pinned_at?: string;
          pinned_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_pinned_messages_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_pinned_messages_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "group_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_pinned_messages_pinned_by_fkey";
            columns: ["pinned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      group_read_receipts: {
        Row: {
          id: string;
          message_id: string;
          read_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          read_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          read_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_read_receipts_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "group_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_read_receipts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      groups: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          description: string | null;
          id: string;
          is_archived: boolean | null;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_archived?: boolean | null;
          name: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_archived?: boolean | null;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "groups_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_analytics: {
        Row: {
          concepts_studied: number;
          correct_answers: number;
          created_at: string;
          date: string;
          exams_completed: number;
          flashcards_reviewed: number;
          id: string;
          notes_created: number;
          questions_answered: number;
          study_time_seconds: number;
          tutor_messages: number;
          updated_at: string;
          user_id: string;
          voice_minutes: number;
          whiteboard_sessions: number;
          xp_earned: number;
        };
        Insert: {
          concepts_studied?: number;
          correct_answers?: number;
          created_at?: string;
          date: string;
          exams_completed?: number;
          flashcards_reviewed?: number;
          id?: string;
          notes_created?: number;
          questions_answered?: number;
          study_time_seconds?: number;
          tutor_messages?: number;
          updated_at?: string;
          user_id: string;
          voice_minutes?: number;
          whiteboard_sessions?: number;
          xp_earned?: number;
        };
        Update: {
          concepts_studied?: number;
          correct_answers?: number;
          created_at?: string;
          date?: string;
          exams_completed?: number;
          flashcards_reviewed?: number;
          id?: string;
          notes_created?: number;
          questions_answered?: number;
          study_time_seconds?: number;
          tutor_messages?: number;
          updated_at?: string;
          user_id?: string;
          voice_minutes?: number;
          whiteboard_sessions?: number;
          xp_earned?: number;
        };
        Relationships: [];
      };
      learning_artifacts: {
        Row: {
          ai_generated: boolean;
          artifact_type: string;
          concept_id: string | null;
          content: Json;
          created_at: string;
          id: string;
          session_id: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          ai_generated?: boolean;
          artifact_type: string;
          concept_id?: string | null;
          content?: Json;
          created_at?: string;
          id?: string;
          session_id?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          ai_generated?: boolean;
          artifact_type?: string;
          concept_id?: string | null;
          content?: Json;
          created_at?: string;
          id?: string;
          session_id?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_artifacts_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_artifacts_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "learning_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_attempts: {
        Row: {
          answer: Json;
          concept_id: string;
          correct: boolean | null;
          created_at: string;
          feedback: string | null;
          id: string;
          misconception: string | null;
          question: Json;
          score: number | null;
          user_id: string;
        };
        Insert: {
          answer?: Json;
          concept_id: string;
          correct?: boolean | null;
          created_at?: string;
          feedback?: string | null;
          id?: string;
          misconception?: string | null;
          question: Json;
          score?: number | null;
          user_id: string;
        };
        Update: {
          answer?: Json;
          concept_id?: string;
          correct?: boolean | null;
          created_at?: string;
          feedback?: string | null;
          id?: string;
          misconception?: string | null;
          question?: Json;
          score?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_attempts_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_board_items: {
        Row: {
          board_id: string;
          created_at: string;
          resource_id: string;
          user_id: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          resource_id: string;
          user_id: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          resource_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_board_items_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "learning_boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_board_items_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "learning_resources";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_boards: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      learning_concepts: {
        Row: {
          chapter: string | null;
          created_at: string;
          description: string;
          difficulty: number;
          estimated_study_minutes: number;
          framework: string;
          grade_band: string;
          id: string;
          keywords: string[];
          learning_objectives: string[];
          license: string;
          misconception_tags: string[];
          prerequisites: string[];
          reviewed: boolean;
          source_url: string | null;
          standard_code: string;
          subject: string;
          title: string;
          version: number;
        };
        Insert: {
          chapter?: string | null;
          created_at?: string;
          description: string;
          difficulty?: number;
          estimated_study_minutes?: number;
          framework: string;
          grade_band: string;
          id: string;
          keywords?: string[];
          learning_objectives?: string[];
          license?: string;
          misconception_tags?: string[];
          prerequisites?: string[];
          reviewed?: boolean;
          source_url?: string | null;
          standard_code: string;
          subject: string;
          title: string;
          version?: number;
        };
        Update: {
          chapter?: string | null;
          created_at?: string;
          description?: string;
          difficulty?: number;
          estimated_study_minutes?: number;
          framework?: string;
          grade_band?: string;
          id?: string;
          keywords?: string[];
          learning_objectives?: string[];
          license?: string;
          misconception_tags?: string[];
          prerequisites?: string[];
          reviewed?: boolean;
          source_url?: string | null;
          standard_code?: string;
          subject?: string;
          title?: string;
          version?: number;
        };
        Relationships: [];
      };
      learning_daily_goals: {
        Row: {
          actual_minutes: number;
          completed_concepts: number;
          created_at: string;
          date: string;
          id: string;
          is_completed: boolean;
          streak_day: number;
          target_concepts: number;
          target_minutes: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          actual_minutes?: number;
          completed_concepts?: number;
          created_at?: string;
          date: string;
          id?: string;
          is_completed?: boolean;
          streak_day?: number;
          target_concepts?: number;
          target_minutes?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          actual_minutes?: number;
          completed_concepts?: number;
          created_at?: string;
          date?: string;
          id?: string;
          is_completed?: boolean;
          streak_day?: number;
          target_concepts?: number;
          target_minutes?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      learning_evidence: {
        Row: {
          concept_id: string;
          created_at: string;
          evidence_type: string;
          id: string;
          note: string | null;
          score: number | null;
          session_id: string | null;
          user_id: string;
        };
        Insert: {
          concept_id: string;
          created_at?: string;
          evidence_type: string;
          id?: string;
          note?: string | null;
          score?: number | null;
          session_id?: string | null;
          user_id: string;
        };
        Update: {
          concept_id?: string;
          created_at?: string;
          evidence_type?: string;
          id?: string;
          note?: string | null;
          score?: number | null;
          session_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_evidence_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_evidence_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "learning_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_exam_answers: {
        Row: {
          ai_evaluation: Json | null;
          answered_at: string;
          exam_id: string;
          feedback: string | null;
          id: string;
          is_correct: boolean | null;
          question_id: string;
          score: number | null;
          time_spent_seconds: number | null;
          user_answer: Json;
        };
        Insert: {
          ai_evaluation?: Json | null;
          answered_at?: string;
          exam_id: string;
          feedback?: string | null;
          id?: string;
          is_correct?: boolean | null;
          question_id: string;
          score?: number | null;
          time_spent_seconds?: number | null;
          user_answer?: Json;
        };
        Update: {
          ai_evaluation?: Json | null;
          answered_at?: string;
          exam_id?: string;
          feedback?: string | null;
          id?: string;
          is_correct?: boolean | null;
          question_id?: string;
          score?: number | null;
          time_spent_seconds?: number | null;
          user_answer?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "learning_exam_answers_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "learning_exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_exam_answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "learning_exam_questions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_exam_questions: {
        Row: {
          concept_id: string | null;
          difficulty: number;
          exam_id: string;
          id: string;
          order_index: number;
          points: number;
          question: Json;
          question_type: string;
        };
        Insert: {
          concept_id?: string | null;
          difficulty: number;
          exam_id: string;
          id?: string;
          order_index?: number;
          points?: number;
          question: Json;
          question_type: string;
        };
        Update: {
          concept_id?: string | null;
          difficulty?: number;
          exam_id?: string;
          id?: string;
          order_index?: number;
          points?: number;
          question?: Json;
          question_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_exam_questions_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_exam_questions_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "learning_exams";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_exams: {
        Row: {
          completed_at: string | null;
          concept_ids: string[];
          correct_answers: number;
          created_at: string;
          exam_type: string;
          id: string;
          score: number | null;
          started_at: string | null;
          status: string;
          time_limit_seconds: number | null;
          title: string;
          total_questions: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          concept_ids?: string[];
          correct_answers?: number;
          created_at?: string;
          exam_type: string;
          id?: string;
          score?: number | null;
          started_at?: string | null;
          status?: string;
          time_limit_seconds?: number | null;
          title: string;
          total_questions?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          concept_ids?: string[];
          correct_answers?: number;
          created_at?: string;
          exam_type?: string;
          id?: string;
          score?: number | null;
          started_at?: string | null;
          status?: string;
          time_limit_seconds?: number | null;
          title?: string;
          total_questions?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      learning_flashcard_reviews: {
        Row: {
          ease_factor: number;
          flashcard_id: string;
          id: string;
          interval_days: number;
          next_review_at: string;
          quality: number;
          repetitions: number;
          response_time_ms: number | null;
          reviewed_at: string;
          user_id: string;
        };
        Insert: {
          ease_factor?: number;
          flashcard_id: string;
          id?: string;
          interval_days?: number;
          next_review_at?: string;
          quality: number;
          repetitions?: number;
          response_time_ms?: number | null;
          reviewed_at?: string;
          user_id: string;
        };
        Update: {
          ease_factor?: number;
          flashcard_id?: string;
          id?: string;
          interval_days?: number;
          next_review_at?: string;
          quality?: number;
          repetitions?: number;
          response_time_ms?: number | null;
          reviewed_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_flashcard_reviews_flashcard_id_fkey";
            columns: ["flashcard_id"];
            isOneToOne: false;
            referencedRelation: "learning_flashcards";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_flashcards: {
        Row: {
          ai_generated: boolean;
          back: string;
          concept_id: string | null;
          created_at: string;
          front: string;
          id: string;
          source_type: string;
          tags: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ai_generated?: boolean;
          back: string;
          concept_id?: string | null;
          created_at?: string;
          front: string;
          id?: string;
          source_type: string;
          tags?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ai_generated?: boolean;
          back?: string;
          concept_id?: string | null;
          created_at?: string;
          front?: string;
          id?: string;
          source_type?: string;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_flashcards_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_history: {
        Row: {
          concept_id: string | null;
          created_at: string;
          duration_seconds: number | null;
          id: string;
          metadata: Json;
          outcome_score: number | null;
          session_type: string;
          summary: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          concept_id?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          metadata?: Json;
          outcome_score?: number | null;
          session_type: string;
          summary?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          concept_id?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          metadata?: Json;
          outcome_score?: number | null;
          session_type?: string;
          summary?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_history_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_integrations: {
        Row: {
          connected_at: string | null;
          display_name: string | null;
          id: string;
          last_synced_at: string | null;
          metadata: Json;
          provider: string;
          status: string;
          user_id: string;
        };
        Insert: {
          connected_at?: string | null;
          display_name?: string | null;
          id?: string;
          last_synced_at?: string | null;
          metadata?: Json;
          provider: string;
          status?: string;
          user_id: string;
        };
        Update: {
          connected_at?: string | null;
          display_name?: string | null;
          id?: string;
          last_synced_at?: string | null;
          metadata?: Json;
          provider?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      learning_mastery: {
        Row: {
          concept_id: string;
          confidence: number;
          estimated_retention: number;
          evidence_count: number;
          last_practiced_at: string | null;
          last_session_type: string | null;
          misconceptions: string[];
          next_review_at: string | null;
          score: number;
          streak: number;
          total_study_time_seconds: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          concept_id: string;
          confidence?: number;
          estimated_retention?: number;
          evidence_count?: number;
          last_practiced_at?: string | null;
          last_session_type?: string | null;
          misconceptions?: string[];
          next_review_at?: string | null;
          score?: number;
          streak?: number;
          total_study_time_seconds?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          concept_id?: string;
          confidence?: number;
          estimated_retention?: number;
          evidence_count?: number;
          last_practiced_at?: string | null;
          last_session_type?: string | null;
          misconceptions?: string[];
          next_review_at?: string | null;
          score?: number;
          streak?: number;
          total_study_time_seconds?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_mastery_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_memory: {
        Row: {
          concept_id: string | null;
          confidence: number;
          content: Json;
          created_at: string;
          id: string;
          importance: number;
          memory_type: string;
          session_id: string | null;
          summary: string | null;
          tags: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          concept_id?: string | null;
          confidence?: number;
          content: Json;
          created_at?: string;
          id?: string;
          importance?: number;
          memory_type: string;
          session_id?: string | null;
          summary?: string | null;
          tags?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          concept_id?: string | null;
          confidence?: number;
          content?: Json;
          created_at?: string;
          id?: string;
          importance?: number;
          memory_type?: string;
          session_id?: string | null;
          summary?: string | null;
          tags?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_memory_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_memory_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "learning_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          idempotency_key: string | null;
          role: string;
          session_id: string;
          source_ids: string[];
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          role: string;
          session_id: string;
          source_ids?: string[];
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string | null;
          role?: string;
          session_id?: string;
          source_ids?: string[];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_messages_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "learning_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_notes: {
        Row: {
          ai_cheat_sheet: string | null;
          ai_key_points: string[] | null;
          ai_summary: string | null;
          concept_id: string | null;
          content: Json;
          content_text: string | null;
          created_at: string;
          id: string;
          is_ai_generated: boolean;
          session_id: string | null;
          tags: string[];
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ai_cheat_sheet?: string | null;
          ai_key_points?: string[] | null;
          ai_summary?: string | null;
          concept_id?: string | null;
          content?: Json;
          content_text?: string | null;
          created_at?: string;
          id?: string;
          is_ai_generated?: boolean;
          session_id?: string | null;
          tags?: string[];
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ai_cheat_sheet?: string | null;
          ai_key_points?: string[] | null;
          ai_summary?: string | null;
          concept_id?: string | null;
          content?: Json;
          content_text?: string | null;
          created_at?: string;
          id?: string;
          is_ai_generated?: boolean;
          session_id?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_notes_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_notes_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "learning_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_ocr_jobs: {
        Row: {
          completed_at: string | null;
          created_at: string;
          error_message: string | null;
          extracted_text: string | null;
          id: string;
          mime_type: string;
          processing_time_ms: number | null;
          source_id: string | null;
          status: string;
          storage_path: string;
          structured_data: Json | null;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          extracted_text?: string | null;
          id?: string;
          mime_type: string;
          processing_time_ms?: number | null;
          source_id?: string | null;
          status?: string;
          storage_path: string;
          structured_data?: Json | null;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          extracted_text?: string | null;
          id?: string;
          mime_type?: string;
          processing_time_ms?: number | null;
          source_id?: string | null;
          status?: string;
          storage_path?: string;
          structured_data?: Json | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_ocr_jobs_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "learning_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_plan_tasks: {
        Row: {
          concept_id: string | null;
          created_at: string;
          due_at: string;
          estimated_minutes: number;
          id: string;
          plan_id: string;
          status: string;
          task_type: string;
          title: string;
          user_id: string;
        };
        Insert: {
          concept_id?: string | null;
          created_at?: string;
          due_at: string;
          estimated_minutes?: number;
          id?: string;
          plan_id: string;
          status?: string;
          task_type: string;
          title: string;
          user_id: string;
        };
        Update: {
          concept_id?: string | null;
          created_at?: string;
          due_at?: string;
          estimated_minutes?: number;
          id?: string;
          plan_id?: string;
          status?: string;
          task_type?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_plan_tasks_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_plan_tasks_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "learning_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_plans: {
        Row: {
          created_at: string;
          ends_on: string;
          generated_from: Json;
          id: string;
          starts_on: string;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          generated_from?: Json;
          id?: string;
          starts_on: string;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          generated_from?: Json;
          id?: string;
          starts_on?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      learning_profiles: {
        Row: {
          created_at: string;
          curriculum: string;
          explanation_depth: string;
          goals: string[];
          grade_band: string;
          interests: string[];
          learning_style: string | null;
          notification_preferences: Json;
          preferred_language: string;
          preferred_pace: string | null;
          reminders_enabled: boolean;
          subjects: string[];
          timezone: string;
          updated_at: string;
          user_id: string;
          weekly_minutes: number;
        };
        Insert: {
          created_at?: string;
          curriculum?: string;
          explanation_depth?: string;
          goals?: string[];
          grade_band?: string;
          interests?: string[];
          learning_style?: string | null;
          notification_preferences?: Json;
          preferred_language?: string;
          preferred_pace?: string | null;
          reminders_enabled?: boolean;
          subjects?: string[];
          timezone?: string;
          updated_at?: string;
          user_id: string;
          weekly_minutes?: number;
        };
        Update: {
          created_at?: string;
          curriculum?: string;
          explanation_depth?: string;
          goals?: string[];
          grade_band?: string;
          interests?: string[];
          learning_style?: string | null;
          notification_preferences?: Json;
          preferred_language?: string;
          preferred_pace?: string | null;
          reminders_enabled?: boolean;
          subjects?: string[];
          timezone?: string;
          updated_at?: string;
          user_id?: string;
          weekly_minutes?: number;
        };
        Relationships: [];
      };
      learning_reminders: {
        Row: {
          created_at: string;
          delivered_at: string | null;
          dismissed_at: string | null;
          id: string;
          message: string;
          scheduled_for: string;
          task_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          delivered_at?: string | null;
          dismissed_at?: string | null;
          id?: string;
          message: string;
          scheduled_for: string;
          task_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          delivered_at?: string | null;
          dismissed_at?: string | null;
          id?: string;
          message?: string;
          scheduled_for?: string;
          task_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_reminders_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "learning_plan_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_resources: {
        Row: {
          ai_generated: boolean;
          chapter: string | null;
          citations: Json | null;
          concept_id: string | null;
          created_at: string;
          difficulty: number | null;
          duration_seconds: number | null;
          id: string;
          license: string | null;
          provenance: string;
          resource_type: string;
          reviewed: boolean;
          source_id: string | null;
          summary: string;
          thumbnail_url: string | null;
          title: string;
          url: string | null;
          user_id: string | null;
          youtube_video_id: string | null;
        };
        Insert: {
          ai_generated?: boolean;
          chapter?: string | null;
          citations?: Json | null;
          concept_id?: string | null;
          created_at?: string;
          difficulty?: number | null;
          duration_seconds?: number | null;
          id?: string;
          license?: string | null;
          provenance: string;
          resource_type: string;
          reviewed?: boolean;
          source_id?: string | null;
          summary: string;
          thumbnail_url?: string | null;
          title: string;
          url?: string | null;
          user_id?: string | null;
          youtube_video_id?: string | null;
        };
        Update: {
          ai_generated?: boolean;
          chapter?: string | null;
          citations?: Json | null;
          concept_id?: string | null;
          created_at?: string;
          difficulty?: number | null;
          duration_seconds?: number | null;
          id?: string;
          license?: string | null;
          provenance?: string;
          resource_type?: string;
          reviewed?: boolean;
          source_id?: string | null;
          summary?: string;
          thumbnail_url?: string | null;
          title?: string;
          url?: string | null;
          user_id?: string | null;
          youtube_video_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "learning_resources_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_resources_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "learning_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_revision_schedule: {
        Row: {
          concept_id: string;
          confidence: number;
          consecutive_failures: number;
          consecutive_successes: number;
          created_at: string;
          ease_factor: number;
          id: string;
          last_reviewed_at: string | null;
          mastery_score: number;
          next_review_at: string;
          retention_estimate: number;
          review_interval_days: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          concept_id: string;
          confidence: number;
          consecutive_failures?: number;
          consecutive_successes?: number;
          created_at?: string;
          ease_factor?: number;
          id?: string;
          last_reviewed_at?: string | null;
          mastery_score: number;
          next_review_at: string;
          retention_estimate: number;
          review_interval_days?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          concept_id?: string;
          confidence?: number;
          consecutive_failures?: number;
          consecutive_successes?: number;
          created_at?: string;
          ease_factor?: number;
          id?: string;
          last_reviewed_at?: string | null;
          mastery_score?: number;
          next_review_at?: string;
          retention_estimate?: number;
          review_interval_days?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_revision_schedule_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_sessions: {
        Row: {
          concept_id: string | null;
          created_at: string;
          id: string;
          status: string;
          subject: string | null;
          title: string;
          topic: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          concept_id?: string | null;
          created_at?: string;
          id?: string;
          status?: string;
          subject?: string | null;
          title?: string;
          topic?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          concept_id?: string | null;
          created_at?: string;
          id?: string;
          status?: string;
          subject?: string | null;
          title?: string;
          topic?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_sessions_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_source_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          created_at: string;
          id: string;
          source_id: string;
          user_id: string;
        };
        Insert: {
          chunk_index: number;
          content: string;
          created_at?: string;
          id?: string;
          source_id: string;
          user_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          created_at?: string;
          id?: string;
          source_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_source_chunks_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "learning_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_sources: {
        Row: {
          created_at: string;
          extracted_text: string | null;
          id: string;
          license: string | null;
          mime_type: string;
          name: string;
          provenance_url: string | null;
          source_kind: string;
          storage_path: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          extracted_text?: string | null;
          id?: string;
          license?: string | null;
          mime_type: string;
          name: string;
          provenance_url?: string | null;
          source_kind: string;
          storage_path?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          extracted_text?: string | null;
          id?: string;
          license?: string | null;
          mime_type?: string;
          name?: string;
          provenance_url?: string | null;
          source_kind?: string;
          storage_path?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      learning_voice_sessions: {
        Row: {
          ai_response: string | null;
          concept_id: string | null;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          language: string;
          mode: string;
          started_at: string;
          status: string;
          transcript: string | null;
          user_id: string;
        };
        Insert: {
          ai_response?: string | null;
          concept_id?: string | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          language?: string;
          mode: string;
          started_at?: string;
          status?: string;
          transcript?: string | null;
          user_id: string;
        };
        Update: {
          ai_response?: string | null;
          concept_id?: string | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          language?: string;
          mode?: string;
          started_at?: string;
          status?: string;
          transcript?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_voice_sessions_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
        ];
      };
      learning_weekly_goals: {
        Row: {
          actual_minutes: number;
          completed_concepts: number;
          completed_exams: number;
          created_at: string;
          id: string;
          is_completed: boolean;
          target_concepts: number;
          target_exams: number;
          target_minutes: number;
          updated_at: string;
          user_id: string;
          week_start: string;
        };
        Insert: {
          actual_minutes?: number;
          completed_concepts?: number;
          completed_exams?: number;
          created_at?: string;
          id?: string;
          is_completed?: boolean;
          target_concepts?: number;
          target_exams?: number;
          target_minutes?: number;
          updated_at?: string;
          user_id: string;
          week_start: string;
        };
        Update: {
          actual_minutes?: number;
          completed_concepts?: number;
          completed_exams?: number;
          created_at?: string;
          id?: string;
          is_completed?: boolean;
          target_concepts?: number;
          target_exams?: number;
          target_minutes?: number;
          updated_at?: string;
          user_id?: string;
          week_start?: string;
        };
        Relationships: [];
      };
      learning_whiteboards: {
        Row: {
          ai_annotations: Json[];
          canvas_data: Json;
          concept_id: string | null;
          created_at: string;
          id: string;
          is_collaborative: boolean;
          session_id: string | null;
          thumbnail_url: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ai_annotations?: Json[];
          canvas_data?: Json;
          concept_id?: string | null;
          created_at?: string;
          id?: string;
          is_collaborative?: boolean;
          session_id?: string | null;
          thumbnail_url?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ai_annotations?: Json[];
          canvas_data?: Json;
          concept_id?: string | null;
          created_at?: string;
          id?: string;
          is_collaborative?: boolean;
          session_id?: string | null;
          thumbnail_url?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "learning_whiteboards_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "learning_concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "learning_whiteboards_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "learning_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          created_at: string;
          embedding: string | null;
          embedding_hash: string | null;
          heading: string | null;
          id: string;
          knowledge_source_id: string;
          language: string;
          page_number: number | null;
          project_id: string | null;
          section: string | null;
          summary: string | null;
          token_count: number;
          user_id: string;
        };
        Insert: {
          chunk_index?: number;
          content?: string;
          created_at?: string;
          embedding?: string | null;
          embedding_hash?: string | null;
          heading?: string | null;
          id?: string;
          knowledge_source_id?: string;
          language?: string;
          page_number?: number | null;
          project_id?: string | null;
          section?: string | null;
          summary?: string | null;
          token_count?: number;
          user_id?: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          created_at?: string;
          embedding?: string | null;
          embedding_hash?: string | null;
          heading?: string | null;
          id?: string;
          knowledge_source_id?: string;
          language?: string;
          page_number?: number | null;
          project_id?: string | null;
          section?: string | null;
          summary?: string | null;
          token_count?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_knowledge_source_id_fkey";
            columns: ["knowledge_source_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_sources: {
        Row: {
          chunk_count: number;
          content_text: string | null;
          created_at: string;
          file_size_bytes: number;
          id: string;
          is_indexed: boolean;
          language: string;
          last_indexed_at: string | null;
          metadata: Json;
          mime_type: string | null;
          name: string;
          page_count: number | null;
          processing_error: string | null;
          processing_status: string;
          project_id: string | null;
          source_type: string;
          source_url: string | null;
          storage_path: string | null;
          updated_at: string;
          user_id: string;
          word_count: number;
        };
        Insert: {
          chunk_count?: number;
          content_text?: string | null;
          created_at?: string;
          file_size_bytes?: number;
          id?: string;
          is_indexed?: boolean;
          language?: string;
          last_indexed_at?: string | null;
          metadata?: Json;
          mime_type?: string | null;
          name: string;
          page_count?: number | null;
          processing_error?: string | null;
          processing_status?: string;
          project_id?: string | null;
          source_type: string;
          source_url?: string | null;
          storage_path?: string | null;
          updated_at?: string;
          user_id?: string;
          word_count?: number;
        };
        Update: {
          chunk_count?: number;
          content_text?: string | null;
          created_at?: string;
          file_size_bytes?: number;
          id?: string;
          is_indexed?: boolean;
          language?: string;
          last_indexed_at?: string | null;
          metadata?: Json;
          mime_type?: string | null;
          name?: string;
          page_count?: number | null;
          processing_error?: string | null;
          processing_status?: string;
          project_id?: string | null;
          source_type?: string;
          source_url?: string | null;
          storage_path?: string | null;
          updated_at?: string;
          user_id?: string;
          word_count?: number;
        };
        Relationships: [];
      };
      project_activity: {
        Row: {
          action: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
          project_id: string;
          user_id: string;
        };
        Insert: {
          action?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
          project_id?: string;
          user_id?: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
          project_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      project_members: {
        Row: {
          id: string;
          invited_by: string | null;
          joined_at: string;
          last_accessed_at: string | null;
          project_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          invited_by?: string | null;
          joined_at?: string;
          last_accessed_at?: string | null;
          project_id?: string;
          role?: string;
          user_id?: string;
        };
        Update: {
          id?: string;
          invited_by?: string | null;
          joined_at?: string;
          last_accessed_at?: string | null;
          project_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      project_notes: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          is_archived: boolean;
          is_pinned: boolean;
          project_id: string;
          tags: string[] | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          is_pinned?: boolean;
          project_id?: string;
          tags?: string[] | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          is_archived?: boolean;
          is_pinned?: boolean;
          project_id?: string;
          tags?: string[] | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      project_tasks: {
        Row: {
          completed_at: string | null;
          created_at: string;
          description: string | null;
          due_date: string | null;
          id: string;
          priority: string;
          project_id: string;
          status: string;
          tags: string[] | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          project_id?: string;
          status?: string;
          tags?: string[] | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          priority?: string;
          project_id?: string;
          status?: string;
          tags?: string[] | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          color: string;
          created_at: string;
          description: string | null;
          icon: string;
          id: string;
          is_archived: boolean;
          is_pinned: boolean;
          last_accessed_at: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          description?: string | null;
          icon?: string;
          id?: string;
          is_archived?: boolean;
          is_pinned?: boolean;
          last_accessed_at?: string;
          name: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          description?: string | null;
          icon?: string;
          id?: string;
          is_archived?: boolean;
          is_pinned?: boolean;
          last_accessed_at?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      search_index: {
        Row: {
          content: string;
          content_vector: string | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          metadata: Json;
          project_id: string | null;
          tags: string[] | null;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          content_vector?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          metadata?: Json;
          project_id?: string | null;
          tags?: string[] | null;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          content?: string;
          content_vector?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          metadata?: Json;
          project_id?: string | null;
          tags?: string[] | null;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      memories: {
        Row: {
          archived: boolean | null;
          category: string | null;
          client_tag: string | null;
          confidence: number;
          content: string | null;
          created_at: string;
          embedding: Json | null;
          embedding_vec: string | null;
          expires_at: string | null;
          id: string;
          importance: number;
          is_user_generated: boolean | null;
          last_accessed: string | null;
          merged_from: string[] | null;
          pinned: boolean | null;
          project_id: string | null;
          source: string;
          summary: string | null;
          tags: string[] | null;
          updated_at: string | null;
          user_id: string | null;
          version: number | null;
        };
        Insert: {
          archived?: boolean | null;
          category?: string | null;
          client_tag?: string | null;
          confidence?: number;
          content?: string | null;
          created_at?: string;
          embedding?: Json | null;
          embedding_vec?: string | null;
          expires_at?: string | null;
          id?: string;
          importance?: number;
          is_user_generated?: boolean | null;
          last_accessed?: string | null;
          merged_from?: string[] | null;
          pinned?: boolean | null;
          project_id?: string | null;
          source?: string;
          summary?: string | null;
          tags?: string[] | null;
          updated_at?: string | null;
          user_id?: string | null;
          version?: number | null;
        };
        Update: {
          archived?: boolean | null;
          category?: string | null;
          client_tag?: string | null;
          confidence?: number;
          content?: string | null;
          created_at?: string;
          embedding?: Json | null;
          embedding_vec?: string | null;
          expires_at?: string | null;
          id?: string;
          importance?: number;
          is_user_generated?: boolean | null;
          last_accessed?: string | null;
          merged_from?: string[] | null;
          pinned?: boolean | null;
          project_id?: string | null;
          source?: string;
          summary?: string | null;
          tags?: string[] | null;
          updated_at?: string | null;
          user_id?: string | null;
          version?: number | null;
        };
        Relationships: [];
      };
      memory_settings: {
        Row: {
          ask_before_save: boolean;
          auto_save: boolean;
          confidence_threshold: number;
          memory_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          ask_before_save?: boolean;
          auto_save?: boolean;
          confidence_threshold?: number;
          memory_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          ask_before_save?: boolean;
          auto_save?: boolean;
          confidence_threshold?: number;
          memory_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          branch_from_message_id: string | null;
          client_tag: string | null;
          content: string | null;
          conversation_id: string | null;
          created_at: string;
          edited_at: string | null;
          id: string;
          is_edited: boolean | null;
          is_regenerated: boolean | null;
          metadata: Json;
          message_type: string;
          model: string | null;
          parent_message_id: string | null;
          project_id: string | null;
          role: string | null;
          streaming: boolean;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          branch_from_message_id?: string | null;
          client_tag?: string | null;
          content?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          is_edited?: boolean | null;
          is_regenerated?: boolean | null;
          metadata?: Json;
          message_type?: string;
          model?: string | null;
          parent_message_id?: string | null;
          project_id?: string | null;
          role?: string | null;
          streaming?: boolean;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          branch_from_message_id?: string | null;
          client_tag?: string | null;
          content?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          is_edited?: boolean | null;
          is_regenerated?: boolean | null;
          metadata?: Json;
          message_type?: string;
          model?: string | null;
          parent_message_id?: string | null;
          project_id?: string | null;
          role?: string | null;
          streaming?: boolean;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          name: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          name?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          name?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      Settings: {
        Row: {
          created_at: string;
          id: string;
          language: string | null;
          notifications_enabled: boolean | null;
          theme: string | null;
          updated_at: string | null;
          user_id: string | null;
          voice_enabled: boolean | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          language?: string | null;
          notifications_enabled?: boolean | null;
          theme?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          voice_enabled?: boolean | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          language?: string | null;
          notifications_enabled?: boolean | null;
          theme?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          voice_enabled?: boolean | null;
        };
        Relationships: [];
      };
      user_settings: {
        Row: {
          ai_model: string | null;
          auto_speak: boolean;
          created_at: string;
          default_mode: string;
          notifications_enabled: boolean;
          theme: string;
          updated_at: string;
          user_id: string;
          voice_rate: number;
        };
        Insert: {
          ai_model?: string | null;
          auto_speak?: boolean;
          created_at?: string;
          default_mode?: string;
          notifications_enabled?: boolean;
          theme?: string;
          updated_at?: string;
          user_id: string;
          voice_rate?: number;
        };
        Update: {
          ai_model?: string | null;
          auto_speak?: boolean;
          created_at?: string;
          default_mode?: string;
          notifications_enabled?: boolean;
          theme?: string;
          updated_at?: string;
          user_id?: string;
          voice_rate?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_group_with_owner: {
        Args: { p_avatar_url?: string; p_description?: string; p_name: string };
        Returns: string;
      };
      debug_uid: { Args: never; Returns: string };
      get_shared_conversation: {
        Args: { share_token: string };
        Returns: {
          content: string;
          created_at: string;
          message_created_at: string;
          message_id: string;
          role: string;
          title: string;
        }[];
      };
      get_user_group_ids: { Args: never; Returns: string[] };
      is_group_admin: { Args: { group_id: string }; Returns: boolean };
      is_group_member: { Args: { group_id: string }; Returns: boolean };
      match_memories: {
        Args: {
          p_categories?: string[];
          p_embedding: Json;
          p_limit?: number;
          p_user_id: string;
        };
        Returns: {
          category: string;
          confidence: number;
          content: string;
          id: string;
          pinned: boolean;
          similarity: number;
        }[];
      };
      match_memories_by_project: {
        Args: {
          p_embedding: Json;
          p_limit?: number;
          p_project_id: string;
          p_user_id: string;
        };
        Returns: {
          category: string;
          confidence: number;
          content: string;
          id: string;
          importance: number;
          pinned: boolean;
          similarity: number;
        }[];
      };
      match_search_index: {
        Args: {
          p_embedding: Json;
          p_entity_types?: string[];
          p_limit?: number;
          p_project_id?: string;
          p_user_id: string;
        };
        Returns: {
          content: string;
          entity_id: string;
          entity_type: string;
          id: string;
          metadata: Json;
          project_id: string;
          similarity: number;
          tags: string[];
          title: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
