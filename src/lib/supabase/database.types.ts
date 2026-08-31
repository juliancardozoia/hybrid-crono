export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      athletes: {
        Row: {
          birth_date: string | null
          created_at: string
          email: string | null
          event_id: string
          external_ref: string | null
          first_name: string
          gender: Database["public"]["Enums"]["athlete_gender"] | null
          id: string
          last_name: string
          phone: string | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          event_id: string
          external_ref?: string | null
          first_name: string
          gender?: Database["public"]["Enums"]["athlete_gender"] | null
          id?: string
          last_name: string
          phone?: string | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          event_id?: string
          external_ref?: string | null
          first_name?: string
          gender?: Database["public"]["Enums"]["athlete_gender"] | null
          id?: string
          last_name?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athletes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      course_templates: {
        Row: {
          created_at: string
          event_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_templates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      division_segment_specs: {
        Row: {
          distance_m: number | null
          division_id: string
          event_id: string
          load_kg: number | null
          notes: string | null
          segment_id: string
          target_reps: number | null
        }
        Insert: {
          distance_m?: number | null
          division_id: string
          event_id: string
          load_kg?: number | null
          notes?: string | null
          segment_id: string
          target_reps?: number | null
        }
        Update: {
          distance_m?: number | null
          division_id?: string
          event_id?: string
          load_kg?: number | null
          notes?: string | null
          segment_id?: string
          target_reps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "division_segment_specs_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "division_segment_specs_segment_id_event_id_fkey"
            columns: ["segment_id", "event_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      divisions: {
        Row: {
          age_max: number | null
          age_min: number | null
          course_template_id: string
          created_at: string
          event_id: string
          gender_rule: Database["public"]["Enums"]["gender_rule"]
          id: string
          level: string | null
          name: string
          team_size: number
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          course_template_id: string
          created_at?: string
          event_id: string
          gender_rule?: Database["public"]["Enums"]["gender_rule"]
          id?: string
          level?: string | null
          name: string
          team_size?: number
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          course_template_id?: string
          created_at?: string
          event_id?: string
          gender_rule?: Database["public"]["Enums"]["gender_rule"]
          id?: string
          level?: string | null
          name?: string
          team_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "divisions_course_template_id_event_id_fkey"
            columns: ["course_template_id", "event_id"]
            isOneToOne: false
            referencedRelation: "course_templates"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "divisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          event_date: string | null
          id: string
          name: string
          org_id: string
          public_slug: string
          status: Database["public"]["Enums"]["event_status"]
          timezone: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          id?: string
          name: string
          org_id: string
          public_slug: string
          status?: Database["public"]["Enums"]["event_status"]
          timezone?: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          created_at?: string
          event_date?: string | null
          id?: string
          name?: string
          org_id?: string
          public_slug?: string
          status?: Database["public"]["Enums"]["event_status"]
          timezone?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      heats: {
        Row: {
          created_at: string
          division_id: string | null
          event_id: string
          id: string
          lane_count: number
          name: string
          scheduled_at: string | null
          start_source: Database["public"]["Enums"]["start_source"] | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["heat_status"]
        }
        Insert: {
          created_at?: string
          division_id?: string | null
          event_id: string
          id?: string
          lane_count?: number
          name: string
          scheduled_at?: string | null
          start_source?: Database["public"]["Enums"]["start_source"] | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["heat_status"]
        }
        Update: {
          created_at?: string
          division_id?: string | null
          event_id?: string
          id?: string
          lane_count?: number
          name?: string
          scheduled_at?: string | null
          start_source?: Database["public"]["Enums"]["start_source"] | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["heat_status"]
        }
        Relationships: [
          {
            foreignKeyName: "heats_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "heats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      lane_audit: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          event_id: string
          id: string
          lane_id: string
          new_judge_id: string | null
          previous_judge_id: string | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          lane_id: string
          new_judge_id?: string | null
          previous_judge_id?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          lane_id?: string
          new_judge_id?: string | null
          previous_judge_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lane_audit_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lane_audit_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
        ]
      }
      lanes: {
        Row: {
          claimed_at: string | null
          created_at: string
          event_id: string
          heat_id: string
          id: string
          judge_id: string | null
          lane_number: number
          lease_expires_at: string | null
          start_offset_ms: number
          status: Database["public"]["Enums"]["lane_status"]
          team_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          event_id: string
          heat_id: string
          id?: string
          judge_id?: string | null
          lane_number: number
          lease_expires_at?: string | null
          start_offset_ms?: number
          status?: Database["public"]["Enums"]["lane_status"]
          team_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          event_id?: string
          heat_id?: string
          id?: string
          judge_id?: string | null
          lane_number?: number
          lease_expires_at?: string | null
          start_offset_ms?: number
          status?: Database["public"]["Enums"]["lane_status"]
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lanes_heat_id_event_id_fkey"
            columns: ["heat_id", "event_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "lanes_team_id_event_id_fkey"
            columns: ["team_id", "event_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      penalty_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["penalty_kind"]
          label: string
          scope_segment_id: string | null
          seconds: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          event_id: string
          id?: string
          kind: Database["public"]["Enums"]["penalty_kind"]
          label: string
          scope_segment_id?: string | null
          seconds?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["penalty_kind"]
          label?: string
          scope_segment_id?: string | null
          seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "penalty_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalty_types_scope_segment_id_event_id_fkey"
            columns: ["scope_segment_id", "event_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      result_publications: {
        Row: {
          division_id: string | null
          event_id: string
          id: string
          published_at: string
          published_by: string | null
          snapshot: Json
        }
        Insert: {
          division_id?: string | null
          event_id: string
          id?: string
          published_at?: string
          published_by?: string | null
          snapshot: Json
        }
        Update: {
          division_id?: string | null
          event_id?: string
          id?: string
          published_at?: string
          published_by?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "result_publications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      results: {
        Row: {
          anomalies: Json
          division_id: string | null
          event_id: string
          heat_id: string
          lane_id: string
          penalty_ms: number
          raw_ms: number | null
          source_event_count: number
          splits: Json
          status: Database["public"]["Enums"]["lane_status"]
          stopped_at_ms: number | null
          team_id: string | null
          total_ms: number | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          anomalies?: Json
          division_id?: string | null
          event_id: string
          heat_id: string
          lane_id: string
          penalty_ms?: number
          raw_ms?: number | null
          source_event_count?: number
          splits?: Json
          status: Database["public"]["Enums"]["lane_status"]
          stopped_at_ms?: number | null
          team_id?: string | null
          total_ms?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          anomalies?: Json
          division_id?: string | null
          event_id?: string
          heat_id?: string
          lane_id?: string
          penalty_ms?: number
          raw_ms?: number | null
          source_event_count?: number
          splits?: Json
          status?: Database["public"]["Enums"]["lane_status"]
          stopped_at_ms?: number | null
          team_id?: string | null
          total_ms?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "results_division_fk"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "results_lane_id_event_id_fkey"
            columns: ["lane_id", "event_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "results_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          course_template_id: string
          created_at: string
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["segment_kind"]
          name: string
          order_index: number
        }
        Insert: {
          course_template_id: string
          created_at?: string
          event_id: string
          id?: string
          kind: Database["public"]["Enums"]["segment_kind"]
          name: string
          order_index: number
        }
        Update: {
          course_template_id?: string
          created_at?: string
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["segment_kind"]
          name?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "segments_course_template_id_event_id_fkey"
            columns: ["course_template_id", "event_id"]
            isOneToOne: false
            referencedRelation: "course_templates"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      team_members: {
        Row: {
          athlete_id: string
          created_at: string
          event_id: string
          team_id: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          event_id: string
          team_id: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          event_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_athlete_id_event_id_fkey"
            columns: ["athlete_id", "event_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "team_members_team_id_event_id_fkey"
            columns: ["team_id", "event_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      teams: {
        Row: {
          bib_number: number
          created_at: string
          division_id: string
          event_id: string
          id: string
          name: string | null
          status: Database["public"]["Enums"]["team_status"]
        }
        Insert: {
          bib_number: number
          created_at?: string
          division_id: string
          event_id: string
          id?: string
          name?: string | null
          status?: Database["public"]["Enums"]["team_status"]
        }
        Update: {
          bib_number?: number
          created_at?: string
          division_id?: string
          event_id?: string
          id?: string
          name?: string | null
          status?: Database["public"]["Enums"]["team_status"]
        }
        Relationships: [
          {
            foreignKeyName: "teams_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "teams_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      timing_events: {
        Row: {
          client_captured_at: string | null
          device_id: string | null
          elapsed_ms: number
          event_id: string
          heat_id: string
          id: string
          lane_id: string
          payload: Json
          recorded_by: string
          segment_id: string | null
          seq: number
          server_received_at: string
          supersedes_id: string | null
          type: Database["public"]["Enums"]["timing_event_type"]
          void_reason: string | null
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          client_captured_at?: string | null
          device_id?: string | null
          elapsed_ms: number
          event_id: string
          heat_id: string
          id: string
          lane_id: string
          payload?: Json
          recorded_by: string
          segment_id?: string | null
          seq: number
          server_received_at?: string
          supersedes_id?: string | null
          type: Database["public"]["Enums"]["timing_event_type"]
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          client_captured_at?: string | null
          device_id?: string | null
          elapsed_ms?: number
          event_id?: string
          heat_id?: string
          id?: string
          lane_id?: string
          payload?: Json
          recorded_by?: string
          segment_id?: string | null
          seq?: number
          server_received_at?: string
          supersedes_id?: string | null
          type?: Database["public"]["Enums"]["timing_event_type"]
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timing_events_heat_id_event_id_fkey"
            columns: ["heat_id", "event_id"]
            isOneToOne: false
            referencedRelation: "heats"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "timing_events_lane_id_event_id_fkey"
            columns: ["lane_id", "event_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "timing_events_recorded_by_profile_fk"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timing_events_segment_id_event_id_fkey"
            columns: ["segment_id", "event_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "timing_events_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "timing_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_function_lockdown: { Args: never; Returns: undefined }
      assign_heat_lanes: {
        Args: { p_heat_id: string; p_team_ids: string[] }
        Returns: undefined
      }
      can_admin_org: { Args: { p_org_id: string }; Returns: boolean }
      can_manage_event: { Args: { p_event_id: string }; Returns: boolean }
      can_verify_event: { Args: { p_event_id: string }; Returns: boolean }
      cancel_heat_start: {
        Args: { p_heat_id: string }
        Returns: {
          created_at: string
          division_id: string | null
          event_id: string
          id: string
          lane_count: number
          name: string
          scheduled_at: string | null
          start_source: Database["public"]["Enums"]["start_source"] | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["heat_status"]
        }
        SetofOptions: {
          from: "*"
          to: "heats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_lane: {
        Args: { p_lane_id: string; p_lease_minutes?: number }
        Returns: {
          claimed_at: string | null
          created_at: string
          event_id: string
          heat_id: string
          id: string
          judge_id: string | null
          lane_number: number
          lease_expires_at: string | null
          start_offset_ms: number
          status: Database["public"]["Enums"]["lane_status"]
          team_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "lanes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      event_config_issues: {
        Args: { p_event_id: string }
        Returns: {
          code: string
          detail: string
          severity: string
        }[]
      }
      event_role: {
        Args: { p_event_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      import_teams: {
        Args: { p_event_id: string; p_teams: Json }
        Returns: {
          bib_number: number
          team_id: string
        }[]
      }
      ingest_timing_events: {
        Args: { p_events: Json }
        Returns: {
          accepted: boolean
          event_id: string
        }[]
      }
      invite_to_org: {
        Args: {
          p_email: string
          p_org_id: string
          p_role?: Database["public"]["Enums"]["org_role"]
        }
        Returns: {
          detalle: string
          estado: string
        }[]
      }
      is_org_owner: { Args: { p_org_id: string }; Returns: boolean }
      public_event_info: {
        Args: { p_public_slug: string }
        Returns: {
          event_date: string
          name: string
          official: boolean
          status: Database["public"]["Enums"]["event_status"]
          venue: string
        }[]
      }
      public_leaderboard: {
        Args: { p_public_slug: string }
        Returns: {
          athletes: string
          bib_number: number
          division_name: string
          official: boolean
          penalty_ms: number
          rank_position: number
          splits: Json
          status: Database["public"]["Enums"]["lane_status"]
          team_name: string
          total_ms: number
        }[]
      }
      publish_results: {
        Args: { p_division_id?: string; p_event_id: string }
        Returns: {
          division_id: string | null
          event_id: string
          id: string
          published_at: string
          published_by: string | null
          snapshot: Json
        }
        SetofOptions: {
          from: "*"
          to: "result_publications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_org_member: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      reorder_segments: {
        Args: { p_ordered_ids: string[]; p_template_id: string }
        Returns: undefined
      }
      shares_org_with: { Args: { p_user_id: string }; Returns: boolean }
      start_heat: {
        Args: { p_heat_id: string }
        Returns: {
          created_at: string
          division_id: string | null
          event_id: string
          id: string
          lane_count: number
          name: string
          scheduled_at: string | null
          start_source: Database["public"]["Enums"]["start_source"] | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["heat_status"]
        }
        SetofOptions: {
          from: "*"
          to: "heats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transfer_lane: {
        Args: { p_lane_id: string; p_reason?: string; p_to_judge: string }
        Returns: {
          claimed_at: string | null
          created_at: string
          event_id: string
          heat_id: string
          id: string
          judge_id: string | null
          lane_number: number
          lease_expires_at: string | null
          start_offset_ms: number
          status: Database["public"]["Enums"]["lane_status"]
          team_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "lanes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_org_role: {
        Args: { p_org_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      verification_queue: {
        Args: { p_event_id: string }
        Returns: {
          anomalies: Json
          bib_number: number
          division_name: string
          event_count: number
          heat_name: string
          lane_id: string
          started_offline: boolean
          status: Database["public"]["Enums"]["lane_status"]
          total_ms: number
          verified: boolean
          voided_count: number
        }[]
      }
      verify_results: {
        Args: { p_division_id?: string; p_event_id: string }
        Returns: number
      }
      void_timing_event: {
        Args: { p_reason: string; p_timing_event_id: string }
        Returns: {
          client_captured_at: string | null
          device_id: string | null
          elapsed_ms: number
          event_id: string
          heat_id: string
          id: string
          lane_id: string
          payload: Json
          recorded_by: string
          segment_id: string | null
          seq: number
          server_received_at: string
          supersedes_id: string | null
          type: Database["public"]["Enums"]["timing_event_type"]
          void_reason: string | null
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "timing_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      athlete_gender: "male" | "female" | "other"
      event_status: "draft" | "ready" | "live" | "verifying" | "published"
      gender_rule: "male" | "female" | "mixed" | "any"
      heat_status: "scheduled" | "armed" | "running" | "finished"
      lane_status: "idle" | "running" | "finished" | "dnf" | "dq"
      org_role: "owner" | "admin" | "head_judge" | "judge"
      penalty_kind: "time_add" | "no_rep" | "dq"
      segment_kind: "run" | "station" | "transition"
      start_source: "server" | "device_offline"
      team_status: "registered" | "checked_in" | "withdrawn"
      timing_event_type:
        | "lane_start"
        | "segment_split"
        | "penalty"
        | "undo"
        | "dnf"
        | "dq"
        | "note"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      athlete_gender: ["male", "female", "other"],
      event_status: ["draft", "ready", "live", "verifying", "published"],
      gender_rule: ["male", "female", "mixed", "any"],
      heat_status: ["scheduled", "armed", "running", "finished"],
      lane_status: ["idle", "running", "finished", "dnf", "dq"],
      org_role: ["owner", "admin", "head_judge", "judge"],
      penalty_kind: ["time_add", "no_rep", "dq"],
      segment_kind: ["run", "station", "transition"],
      start_source: ["server", "device_offline"],
      team_status: ["registered", "checked_in", "withdrawn"],
      timing_event_type: [
        "lane_start",
        "segment_split",
        "penalty",
        "undo",
        "dnf",
        "dq",
        "note",
      ],
    },
  },
} as const
