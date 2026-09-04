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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      arenas: {
        Row: {
          created_at: string
          default_heat_minutes: number
          event_id: string
          id: string
          name: string
          order_index: number
        }
        Insert: {
          created_at?: string
          default_heat_minutes?: number
          event_id: string
          id?: string
          name: string
          order_index?: number
        }
        Update: {
          created_at?: string
          default_heat_minutes?: number
          event_id?: string
          id?: string
          name?: string
          order_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "arenas_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          birth_date: string | null
          box: string | null
          country: string | null
          created_at: string
          document_id: string | null
          email: string | null
          event_id: string
          external_ref: string | null
          first_name: string
          gender: Database["public"]["Enums"]["athlete_gender"] | null
          id: string
          last_name: string
          phone: string | null
          profile_id: string | null
          shirt_size: string | null
          state_province: string | null
        }
        Insert: {
          birth_date?: string | null
          box?: string | null
          country?: string | null
          created_at?: string
          document_id?: string | null
          email?: string | null
          event_id: string
          external_ref?: string | null
          first_name: string
          gender?: Database["public"]["Enums"]["athlete_gender"] | null
          id?: string
          last_name: string
          phone?: string | null
          profile_id?: string | null
          shirt_size?: string | null
          state_province?: string | null
        }
        Update: {
          birth_date?: string | null
          box?: string | null
          country?: string | null
          created_at?: string
          document_id?: string | null
          email?: string | null
          event_id?: string
          external_ref?: string | null
          first_name?: string
          gender?: Database["public"]["Enums"]["athlete_gender"] | null
          id?: string
          last_name?: string
          phone?: string | null
          profile_id?: string | null
          shirt_size?: string | null
          state_province?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athletes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_accounts: {
        Row: {
          billing_email: string | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          card_token: string
          created_at: string
          holder_name: string | null
          org_id: string
          provider: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_token: string
          created_at?: string
          holder_name?: string | null
          org_id: string
          provider: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          card_token?: string
          created_at?: string
          holder_name?: string | null
          org_id?: string
          provider?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
      discount_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          division_id: string | null
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["discount_kind"]
          max_uses: number | null
          used_count: number
          valid_from: string | null
          valid_to: string | null
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          division_id?: string | null
          event_id: string
          id?: string
          kind: Database["public"]["Enums"]["discount_kind"]
          max_uses?: number | null
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
          value: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          division_id?: string | null
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["discount_kind"]
          max_uses?: number | null
          used_count?: number
          valid_from?: string | null
          valid_to?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_codes_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "discount_codes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      division_movement_specs: {
        Row: {
          division_id: string
          event_id: string
          load_kg: number | null
          notes: string | null
          part_movement_id: string
          target_per_round: number[] | null
        }
        Insert: {
          division_id: string
          event_id: string
          load_kg?: number | null
          notes?: string | null
          part_movement_id: string
          target_per_round?: number[] | null
        }
        Update: {
          division_id?: string
          event_id?: string
          load_kg?: number | null
          notes?: string | null
          part_movement_id?: string
          target_per_round?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "division_movement_specs_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "division_movement_specs_part_movement_id_event_id_fkey"
            columns: ["part_movement_id", "event_id"]
            isOneToOne: false
            referencedRelation: "part_movements"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      division_movements: {
        Row: {
          created_at: string
          custom_name: string | null
          division_id: string
          event_id: string
          id: string
          load_kg: number | null
          load_unit: Database["public"]["Enums"]["load_unit"]
          movement_id: string | null
          notes: string | null
          order_index: number
          spec: string | null
        }
        Insert: {
          created_at?: string
          custom_name?: string | null
          division_id: string
          event_id: string
          id?: string
          load_kg?: number | null
          load_unit?: Database["public"]["Enums"]["load_unit"]
          movement_id?: string | null
          notes?: string | null
          order_index?: number
          spec?: string | null
        }
        Update: {
          created_at?: string
          custom_name?: string | null
          division_id?: string
          event_id?: string
          id?: string
          load_kg?: number | null
          load_unit?: Database["public"]["Enums"]["load_unit"]
          movement_id?: string | null
          notes?: string | null
          order_index?: number
          spec?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "division_movements_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "division_movements_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
        ]
      }
      division_registration: {
        Row: {
          allows_member_swap: boolean
          capacity: number | null
          closes_at: string | null
          currency: string
          division_id: string
          event_id: string
          opens_at: string | null
          price_cents: number | null
        }
        Insert: {
          allows_member_swap?: boolean
          capacity?: number | null
          closes_at?: string | null
          currency?: string
          division_id: string
          event_id: string
          opens_at?: string | null
          price_cents?: number | null
        }
        Update: {
          allows_member_swap?: boolean
          capacity?: number | null
          closes_at?: string | null
          currency?: string
          division_id?: string
          event_id?: string
          opens_at?: string | null
          price_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "division_registration_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
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
          course_template_id: string | null
          created_at: string
          event_id: string
          gender_rule: Database["public"]["Enums"]["gender_rule"]
          id: string
          level: string | null
          name: string
          scoring_table_id: string | null
          team_size: number
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          course_template_id?: string | null
          created_at?: string
          event_id: string
          gender_rule?: Database["public"]["Enums"]["gender_rule"]
          id?: string
          level?: string | null
          name: string
          scoring_table_id?: string | null
          team_size?: number
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          course_template_id?: string | null
          created_at?: string
          event_id?: string
          gender_rule?: Database["public"]["Enums"]["gender_rule"]
          id?: string
          level?: string | null
          name?: string
          scoring_table_id?: string | null
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
          {
            foreignKeyName: "divisions_scoring_table_id_fkey"
            columns: ["scoring_table_id"]
            isOneToOne: false
            referencedRelation: "scoring_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      event_documents: {
        Row: {
          created_at: string
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["event_document_kind"]
          name: string
          order_index: number
          requires_acceptance: boolean
          url: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          kind?: Database["public"]["Enums"]["event_document_kind"]
          name: string
          order_index?: number
          requires_acceptance?: boolean
          url: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["event_document_kind"]
          name?: string
          order_index?: number
          requires_acceptance?: boolean
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_documents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_staff: {
        Row: {
          accepted_at: string | null
          approved_at: string | null
          can_delete_registrations: boolean
          can_edit_registrations: boolean
          can_edit_scores: boolean
          can_manage_workouts: boolean
          created_at: string
          event_id: string
          id: string
          invited_by: string | null
          invited_email: string
          is_admin: boolean
          role: Database["public"]["Enums"]["event_staff_role"]
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          approved_at?: string | null
          can_delete_registrations?: boolean
          can_edit_registrations?: boolean
          can_edit_scores?: boolean
          can_manage_workouts?: boolean
          created_at?: string
          event_id: string
          id?: string
          invited_by?: string | null
          invited_email: string
          is_admin?: boolean
          role?: Database["public"]["Enums"]["event_staff_role"]
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          approved_at?: string | null
          can_delete_registrations?: boolean
          can_edit_registrations?: boolean
          can_edit_scores?: boolean
          can_manage_workouts?: boolean
          created_at?: string
          event_id?: string
          id?: string
          invited_by?: string | null
          invited_email?: string
          is_admin?: boolean
          role?: Database["public"]["Enums"]["event_staff_role"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_staff_divisions: {
        Row: {
          division_id: string
          event_id: string
          staff_id: string
        }
        Insert: {
          division_id: string
          event_id: string
          staff_id: string
        }
        Update: {
          division_id?: string
          event_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_divisions_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "event_staff_divisions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "event_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          allow_judge_self_claim: boolean
          auto_tiebreak: boolean
          city: string | null
          country: string | null
          cover_url: string | null
          created_at: string
          currency: string
          description: string | null
          ends_at: string | null
          event_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          featured_at: string | null
          format: Database["public"]["Enums"]["event_format"]
          id: string
          instagram: string | null
          logo_url: string | null
          name: string
          org_id: string
          organizer_name: string | null
          organizer_phone: string | null
          organizer_phone_country: string | null
          public_slug: string
          published_at: string | null
          registration_closes_at: string | null
          registration_opens_at: string | null
          shirt_sizes: string[]
          starts_at: string | null
          state: string | null
          status: Database["public"]["Enums"]["event_status"]
          timezone: string
          updated_at: string
          venue: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          allow_judge_self_claim?: boolean
          auto_tiebreak?: boolean
          city?: string | null
          country?: string | null
          cover_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          ends_at?: string | null
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          featured_at?: string | null
          format?: Database["public"]["Enums"]["event_format"]
          id?: string
          instagram?: string | null
          logo_url?: string | null
          name: string
          org_id: string
          organizer_name?: string | null
          organizer_phone?: string | null
          organizer_phone_country?: string | null
          public_slug: string
          published_at?: string | null
          registration_closes_at?: string | null
          registration_opens_at?: string | null
          shirt_sizes?: string[]
          starts_at?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          timezone?: string
          updated_at?: string
          venue?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          allow_judge_self_claim?: boolean
          auto_tiebreak?: boolean
          city?: string | null
          country?: string | null
          cover_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          ends_at?: string | null
          event_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          featured_at?: string | null
          format?: Database["public"]["Enums"]["event_format"]
          id?: string
          instagram?: string | null
          logo_url?: string | null
          name?: string
          org_id?: string
          organizer_name?: string | null
          organizer_phone?: string | null
          organizer_phone_country?: string | null
          public_slug?: string
          published_at?: string | null
          registration_closes_at?: string | null
          registration_opens_at?: string | null
          shirt_sizes?: string[]
          starts_at?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          timezone?: string
          updated_at?: string
          venue?: string | null
          website?: string | null
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
          arena_id: string | null
          created_at: string
          division_id: string | null
          ended_at: string | null
          event_id: string
          id: string
          lane_count: number
          name: string
          scheduled_at: string | null
          scheduled_end_at: string | null
          start_source: Database["public"]["Enums"]["start_source"] | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["heat_status"]
          workout_id: string
        }
        Insert: {
          arena_id?: string | null
          created_at?: string
          division_id?: string | null
          ended_at?: string | null
          event_id: string
          id?: string
          lane_count?: number
          name: string
          scheduled_at?: string | null
          scheduled_end_at?: string | null
          start_source?: Database["public"]["Enums"]["start_source"] | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["heat_status"]
          workout_id: string
        }
        Update: {
          arena_id?: string | null
          created_at?: string
          division_id?: string | null
          ended_at?: string | null
          event_id?: string
          id?: string
          lane_count?: number
          name?: string
          scheduled_at?: string | null
          scheduled_end_at?: string | null
          start_source?: Database["public"]["Enums"]["start_source"] | null
          started_at?: string | null
          started_by?: string | null
          status?: Database["public"]["Enums"]["heat_status"]
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "heats_arena_fk"
            columns: ["arena_id", "event_id"]
            isOneToOne: false
            referencedRelation: "arenas"
            referencedColumns: ["id", "event_id"]
          },
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
          {
            foreignKeyName: "heats_workout_fk"
            columns: ["workout_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id", "event_id"]
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
          workout_id: string
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
          workout_id: string
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
          workout_id?: string
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
          {
            foreignKeyName: "lanes_workout_fk"
            columns: ["workout_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      movements: {
        Row: {
          active: boolean
          allows_load: boolean
          category: Database["public"]["Enums"]["movement_category"]
          created_at: string
          default_unit: Database["public"]["Enums"]["movement_unit"]
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          allows_load?: boolean
          category: Database["public"]["Enums"]["movement_category"]
          created_at?: string
          default_unit?: Database["public"]["Enums"]["movement_unit"]
          id?: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          allows_load?: boolean
          category?: Database["public"]["Enums"]["movement_category"]
          created_at?: string
          default_unit?: Database["public"]["Enums"]["movement_unit"]
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          discount_cents: number
          discount_code_id: string | null
          event_id: string
          id: string
          paid_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          registration_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          discount_cents?: number
          discount_code_id?: string | null
          event_id: string
          id?: string
          paid_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          registration_id: string
          status?: Database["public"]["Enums"]["order_status"]
          total_cents?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          discount_cents?: number
          discount_code_id?: string | null
          event_id?: string
          id?: string
          paid_at?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          registration_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_registration_id_event_id_fkey"
            columns: ["registration_id", "event_id"]
            isOneToOne: false
            referencedRelation: "registrations"
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
          plan: Database["public"]["Enums"]["org_plan"]
          slug: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          plan?: Database["public"]["Enums"]["org_plan"]
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["org_plan"]
          slug?: string
        }
        Relationships: []
      }
      part_blocks: {
        Row: {
          created_at: string
          descanso_ms: number | null
          duracion_ms: number | null
          event_id: string
          id: string
          kind: Database["public"]["Enums"]["block_kind"]
          label: string | null
          order_index: number
          part_id: string
          repeticiones: number
          team_mode: Database["public"]["Enums"]["team_mode"] | null
        }
        Insert: {
          created_at?: string
          descanso_ms?: number | null
          duracion_ms?: number | null
          event_id: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          label?: string | null
          order_index: number
          part_id: string
          repeticiones?: number
          team_mode?: Database["public"]["Enums"]["team_mode"] | null
        }
        Update: {
          created_at?: string
          descanso_ms?: number | null
          duracion_ms?: number | null
          event_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["block_kind"]
          label?: string | null
          order_index?: number
          part_id?: string
          repeticiones?: number
          team_mode?: Database["public"]["Enums"]["team_mode"] | null
        }
        Relationships: [
          {
            foreignKeyName: "part_blocks_part_id_event_id_fkey"
            columns: ["part_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workout_parts"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      part_divisions: {
        Row: {
          course_template_id: string | null
          division_id: string
          event_id: string
          part_id: string
          scoring_table_id: string | null
          time_cap_ms: number | null
        }
        Insert: {
          course_template_id?: string | null
          division_id: string
          event_id: string
          part_id: string
          scoring_table_id?: string | null
          time_cap_ms?: number | null
        }
        Update: {
          course_template_id?: string | null
          division_id?: string
          event_id?: string
          part_id?: string
          scoring_table_id?: string | null
          time_cap_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "part_divisions_course_template_id_event_id_fkey"
            columns: ["course_template_id", "event_id"]
            isOneToOne: false
            referencedRelation: "course_templates"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "part_divisions_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "part_divisions_part_id_event_id_fkey"
            columns: ["part_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workout_parts"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "part_divisions_scoring_table_id_fkey"
            columns: ["scoring_table_id"]
            isOneToOne: false
            referencedRelation: "scoring_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      part_movements: {
        Row: {
          block_id: string
          created_at: string
          custom_name: string | null
          es_tiebreak: boolean
          event_id: string
          id: string
          load_kg: number | null
          max_reps: boolean
          movement_id: string | null
          notes: string | null
          order_index: number
          part_id: string
          target_per_round: number[]
          unit: Database["public"]["Enums"]["movement_unit"]
        }
        Insert: {
          block_id: string
          created_at?: string
          custom_name?: string | null
          es_tiebreak?: boolean
          event_id: string
          id?: string
          load_kg?: number | null
          max_reps?: boolean
          movement_id?: string | null
          notes?: string | null
          order_index: number
          part_id: string
          target_per_round?: number[]
          unit?: Database["public"]["Enums"]["movement_unit"]
        }
        Update: {
          block_id?: string
          created_at?: string
          custom_name?: string | null
          es_tiebreak?: boolean
          event_id?: string
          id?: string
          load_kg?: number | null
          max_reps?: boolean
          movement_id?: string | null
          notes?: string | null
          order_index?: number
          part_id?: string
          target_per_round?: number[]
          unit?: Database["public"]["Enums"]["movement_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "part_movements_block_id_event_id_fkey"
            columns: ["block_id", "event_id"]
            isOneToOne: false
            referencedRelation: "part_blocks"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "part_movements_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_movements_part_id_event_id_fkey"
            columns: ["part_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workout_parts"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_cents: number | null
          created_at: string
          event_id: string
          external_id: string | null
          id: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          raw: Json
          status: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          event_id: string
          external_id?: string | null
          id?: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          raw?: Json
          status: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          event_id?: string
          external_id?: string | null
          id?: string
          order_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          raw?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string | null
          org_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          public_config: Json
          secret_ciphertext: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          org_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          public_config?: Json
          secret_ciphertext?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          org_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          public_config?: Json
          secret_ciphertext?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          avatar_url: string | null
          birth_date: string | null
          city: string | null
          country: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          instagram: string | null
          phone: string | null
          phone_country: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          instagram?: string | null
          phone?: string | null
          phone_country?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          instagram?: string | null
          phone?: string | null
          phone_country?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      registration_fields: {
        Row: {
          created_at: string
          division_id: string | null
          event_id: string
          id: string
          key: string
          label: string
          options: string[]
          order_index: number
          required: boolean
          scope: string
          type: Database["public"]["Enums"]["registration_field_type"]
        }
        Insert: {
          created_at?: string
          division_id?: string | null
          event_id: string
          id?: string
          key: string
          label: string
          options?: string[]
          order_index?: number
          required?: boolean
          scope?: string
          type?: Database["public"]["Enums"]["registration_field_type"]
        }
        Update: {
          created_at?: string
          division_id?: string | null
          event_id?: string
          id?: string
          key?: string
          label?: string
          options?: string[]
          order_index?: number
          required?: boolean
          scope?: string
          type?: Database["public"]["Enums"]["registration_field_type"]
        }
        Relationships: [
          {
            foreignKeyName: "registration_fields_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "registration_fields_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_members: {
        Row: {
          accepted_terms_at: string | null
          answers: Json
          birth_date: string | null
          box: string | null
          country: string | null
          created_at: string
          document_id: string | null
          event_id: string
          first_name: string | null
          gender: Database["public"]["Enums"]["athlete_gender"] | null
          id: string
          invited_email: string
          last_name: string | null
          phone: string | null
          position: number
          profile_id: string | null
          registration_id: string
          shirt_size: string | null
          state_province: string | null
          status: Database["public"]["Enums"]["registration_member_status"]
          updated_at: string
        }
        Insert: {
          accepted_terms_at?: string | null
          answers?: Json
          birth_date?: string | null
          box?: string | null
          country?: string | null
          created_at?: string
          document_id?: string | null
          event_id: string
          first_name?: string | null
          gender?: Database["public"]["Enums"]["athlete_gender"] | null
          id?: string
          invited_email: string
          last_name?: string | null
          phone?: string | null
          position: number
          profile_id?: string | null
          registration_id: string
          shirt_size?: string | null
          state_province?: string | null
          status?: Database["public"]["Enums"]["registration_member_status"]
          updated_at?: string
        }
        Update: {
          accepted_terms_at?: string | null
          answers?: Json
          birth_date?: string | null
          box?: string | null
          country?: string | null
          created_at?: string
          document_id?: string | null
          event_id?: string
          first_name?: string | null
          gender?: Database["public"]["Enums"]["athlete_gender"] | null
          id?: string
          invited_email?: string
          last_name?: string | null
          phone?: string | null
          position?: number
          profile_id?: string | null
          registration_id?: string
          shirt_size?: string | null
          state_province?: string | null
          status?: Database["public"]["Enums"]["registration_member_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_members_registration_id_event_id_fkey"
            columns: ["registration_id", "event_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      registrations: {
        Row: {
          answers: Json
          confirmed_at: string | null
          created_at: string
          created_by: string
          currency: string | null
          division_id: string
          event_id: string
          id: string
          price_cents: number | null
          status: Database["public"]["Enums"]["registration_status"]
          submitted_at: string | null
          team_id: string | null
          team_name: string | null
          updated_at: string
        }
        Insert: {
          answers?: Json
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          currency?: string | null
          division_id: string
          event_id: string
          id?: string
          price_cents?: number | null
          status?: Database["public"]["Enums"]["registration_status"]
          submitted_at?: string | null
          team_id?: string | null
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          answers?: Json
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          currency?: string | null
          division_id?: string
          event_id?: string
          id?: string
          price_cents?: number | null
          status?: Database["public"]["Enums"]["registration_status"]
          submitted_at?: string | null
          team_id?: string | null
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registrations_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_team_id_event_id_fkey"
            columns: ["team_id", "event_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      result_publications: {
        Row: {
          division_id: string | null
          event_id: string
          id: string
          published_at: string
          published_by: string | null
          snapshot: Json
          snapshot_version: number
        }
        Insert: {
          division_id?: string | null
          event_id: string
          id?: string
          published_at?: string
          published_by?: string | null
          snapshot: Json
          snapshot_version?: number
        }
        Update: {
          division_id?: string | null
          event_id?: string
          id?: string
          published_at?: string
          published_by?: string | null
          snapshot?: Json
          snapshot_version?: number
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
      scoring_tables: {
        Row: {
          builtin_key: string | null
          created_at: string
          id: string
          name: string
          org_id: string | null
          points: number[]
        }
        Insert: {
          builtin_key?: string | null
          created_at?: string
          id?: string
          name: string
          org_id?: string | null
          points?: number[]
        }
        Update: {
          builtin_key?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string | null
          points?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "scoring_tables_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      standings: {
        Row: {
          division_id: string
          event_id: string
          per_part: Json
          position: number
          team_id: string
          tiebreak_vector: number[]
          tied_with: number
          total_points: number
          updated_at: string
        }
        Insert: {
          division_id: string
          event_id: string
          per_part?: Json
          position: number
          team_id: string
          tiebreak_vector?: number[]
          tied_with?: number
          total_points?: number
          updated_at?: string
        }
        Update: {
          division_id?: string
          event_id?: string
          per_part?: Json
          position?: number
          team_id?: string
          tiebreak_vector?: number[]
          tied_with?: number
          total_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "standings_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "standings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standings_team_id_event_id_fkey"
            columns: ["team_id", "event_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
          approved: boolean
          bib_number: number
          created_at: string
          division_id: string
          event_id: string
          id: string
          name: string | null
          status: Database["public"]["Enums"]["team_status"]
        }
        Insert: {
          approved?: boolean
          bib_number: number
          created_at?: string
          division_id: string
          event_id: string
          id?: string
          name?: string | null
          status?: Database["public"]["Enums"]["team_status"]
        }
        Update: {
          approved?: boolean
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
      workout_parts: {
        Row: {
          cap_unit: Database["public"]["Enums"]["score_unit"] | null
          capture_mode: Database["public"]["Enums"]["capture_mode"]
          created_at: string
          event_id: string
          id: string
          interval_ms: number | null
          label: string
          order_index: number
          score_dir: Database["public"]["Enums"]["score_dir"]
          score_unit: Database["public"]["Enums"]["score_unit"]
          team_mode: Database["public"]["Enums"]["team_mode"]
          tiebreak_dir: Database["public"]["Enums"]["score_dir"] | null
          tiebreak_part_id: string | null
          tiebreak_source: Database["public"]["Enums"]["tiebreak_source"] | null
          tiebreak_unit: Database["public"]["Enums"]["score_unit"] | null
          time_cap_ms: number | null
          time_scheme: Database["public"]["Enums"]["time_scheme"]
          window_ms: number | null
          workout_id: string
        }
        Insert: {
          cap_unit?: Database["public"]["Enums"]["score_unit"] | null
          capture_mode?: Database["public"]["Enums"]["capture_mode"]
          created_at?: string
          event_id: string
          id?: string
          interval_ms?: number | null
          label?: string
          order_index: number
          score_dir: Database["public"]["Enums"]["score_dir"]
          score_unit: Database["public"]["Enums"]["score_unit"]
          team_mode?: Database["public"]["Enums"]["team_mode"]
          tiebreak_dir?: Database["public"]["Enums"]["score_dir"] | null
          tiebreak_part_id?: string | null
          tiebreak_source?:
            | Database["public"]["Enums"]["tiebreak_source"]
            | null
          tiebreak_unit?: Database["public"]["Enums"]["score_unit"] | null
          time_cap_ms?: number | null
          time_scheme: Database["public"]["Enums"]["time_scheme"]
          window_ms?: number | null
          workout_id: string
        }
        Update: {
          cap_unit?: Database["public"]["Enums"]["score_unit"] | null
          capture_mode?: Database["public"]["Enums"]["capture_mode"]
          created_at?: string
          event_id?: string
          id?: string
          interval_ms?: number | null
          label?: string
          order_index?: number
          score_dir?: Database["public"]["Enums"]["score_dir"]
          score_unit?: Database["public"]["Enums"]["score_unit"]
          team_mode?: Database["public"]["Enums"]["team_mode"]
          tiebreak_dir?: Database["public"]["Enums"]["score_dir"] | null
          tiebreak_part_id?: string | null
          tiebreak_source?:
            | Database["public"]["Enums"]["tiebreak_source"]
            | null
          tiebreak_unit?: Database["public"]["Enums"]["score_unit"] | null
          time_cap_ms?: number | null
          time_scheme?: Database["public"]["Enums"]["time_scheme"]
          window_ms?: number | null
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_parts_tiebreak_part_id_event_id_fkey"
            columns: ["tiebreak_part_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workout_parts"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "workout_parts_workout_id_event_id_fkey"
            columns: ["workout_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      workout_score_audit: {
        Row: {
          actor_id: string | null
          antes: Json | null
          created_at: string
          despues: Json
          event_id: string
          id: string
          motivo: string | null
          part_id: string
          team_id: string
        }
        Insert: {
          actor_id?: string | null
          antes?: Json | null
          created_at?: string
          despues: Json
          event_id: string
          id?: string
          motivo?: string | null
          part_id: string
          team_id: string
        }
        Update: {
          actor_id?: string | null
          antes?: Json | null
          created_at?: string
          despues?: Json
          event_id?: string
          id?: string
          motivo?: string | null
          part_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_score_audit_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_scores: {
        Row: {
          division_id: string
          entered_at: string | null
          entered_by: string | null
          event_id: string
          lane_id: string | null
          part_id: string
          score_unit: Database["public"]["Enums"]["score_unit"]
          source: Database["public"]["Enums"]["capture_mode"]
          status: Database["public"]["Enums"]["score_status"]
          team_id: string
          tiebreak_value: number | null
          updated_at: string
          value_cap: number | null
          value_num: number | null
          value_reps: number | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          division_id: string
          entered_at?: string | null
          entered_by?: string | null
          event_id: string
          lane_id?: string | null
          part_id: string
          score_unit: Database["public"]["Enums"]["score_unit"]
          source?: Database["public"]["Enums"]["capture_mode"]
          status?: Database["public"]["Enums"]["score_status"]
          team_id: string
          tiebreak_value?: number | null
          updated_at?: string
          value_cap?: number | null
          value_num?: number | null
          value_reps?: number | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          division_id?: string
          entered_at?: string | null
          entered_by?: string | null
          event_id?: string
          lane_id?: string | null
          part_id?: string
          score_unit?: Database["public"]["Enums"]["score_unit"]
          source?: Database["public"]["Enums"]["capture_mode"]
          status?: Database["public"]["Enums"]["score_status"]
          team_id?: string
          tiebreak_value?: number | null
          updated_at?: string
          value_cap?: number | null
          value_num?: number | null
          value_reps?: number | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_scores_division_id_event_id_fkey"
            columns: ["division_id", "event_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "workout_scores_lane_id_event_id_fkey"
            columns: ["lane_id", "event_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "workout_scores_part_id_event_id_fkey"
            columns: ["part_id", "event_id"]
            isOneToOne: false
            referencedRelation: "workout_parts"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "workout_scores_team_id_event_id_fkey"
            columns: ["team_id", "event_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          description: string | null
          event_id: string
          id: string
          name: string
          order_index: number
          released_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          name: string
          order_index: number
          released_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          name?: string
          order_index?: number
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workouts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activar_plan_pro: {
        Args: { p_org_id: string }
        Returns: Database["public"]["Enums"]["org_plan"]
      }
      admin_create_registration: {
        Args: {
          p_division_id: string
          p_estado?: string
          p_integrantes: Json
          p_team_name: string
        }
        Returns: {
          approved: boolean
          bib_number: number
          created_at: string
          division_id: string
          event_id: string
          id: string
          name: string | null
          status: Database["public"]["Enums"]["team_status"]
        }
        SetofOptions: {
          from: "*"
          to: "teams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_as_judge: {
        Args: { p_public_slug: string }
        Returns: {
          accepted_at: string | null
          approved_at: string | null
          can_delete_registrations: boolean
          can_edit_registrations: boolean
          can_edit_scores: boolean
          can_manage_workouts: boolean
          created_at: string
          event_id: string
          id: string
          invited_by: string | null
          invited_email: string
          is_admin: boolean
          role: Database["public"]["Enums"]["event_staff_role"]
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "event_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_function_lockdown: { Args: never; Returns: undefined }
      approve_event_staff: {
        Args: { p_staff_id: string }
        Returns: {
          accepted_at: string | null
          approved_at: string | null
          can_delete_registrations: boolean
          can_edit_registrations: boolean
          can_edit_scores: boolean
          can_manage_workouts: boolean
          created_at: string
          event_id: string
          id: string
          invited_by: string | null
          invited_email: string
          is_admin: boolean
          role: Database["public"]["Enums"]["event_staff_role"]
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "event_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_heat_lanes: {
        Args: { p_heat_id: string; p_team_ids: string[] }
        Returns: undefined
      }
      auto_distribuir_heats: {
        Args: { p_event_id: string; p_lanes_por_heat: number }
        Returns: {
          division_id: string
          division_name: string
          equipos_asignados: number
          heats_creados: number
        }[]
      }
      can_admin_org: { Args: { p_org_id: string }; Returns: boolean }
      can_delete_registrations: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      can_manage_event: { Args: { p_event_id: string }; Returns: boolean }
      can_manage_workouts: { Args: { p_event_id: string }; Returns: boolean }
      can_register_event: { Args: { p_event_id: string }; Returns: boolean }
      can_score_event: { Args: { p_event_id: string }; Returns: boolean }
      can_verify_event: { Args: { p_event_id: string }; Returns: boolean }
      cancel_heat_start: {
        Args: { p_heat_id: string }
        Returns: {
          arena_id: string | null
          created_at: string
          division_id: string | null
          ended_at: string | null
          event_id: string
          id: string
          lane_count: number
          name: string
          scheduled_at: string | null
          scheduled_end_at: string | null
          start_source: Database["public"]["Enums"]["start_source"] | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["heat_status"]
          workout_id: string
        }
        SetofOptions: {
          from: "*"
          to: "heats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_registration: {
        Args: { p_registration_id: string }
        Returns: {
          answers: Json
          confirmed_at: string | null
          created_at: string
          created_by: string
          currency: string | null
          division_id: string
          event_id: string
          id: string
          price_cents: number | null
          status: Database["public"]["Enums"]["registration_status"]
          submitted_at: string | null
          team_id: string | null
          team_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_plan_pro: {
        Args: { p_org_id: string }
        Returns: Database["public"]["Enums"]["org_plan"]
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
          workout_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lanes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_membership: {
        Args: { p_registration_id: string }
        Returns: {
          accepted_terms_at: string | null
          answers: Json
          birth_date: string | null
          box: string | null
          country: string | null
          created_at: string
          document_id: string | null
          event_id: string
          first_name: string | null
          gender: Database["public"]["Enums"]["athlete_gender"] | null
          id: string
          invited_email: string
          last_name: string | null
          phone: string | null
          position: number
          profile_id: string | null
          registration_id: string
          shirt_size: string | null
          state_province: string | null
          status: Database["public"]["Enums"]["registration_member_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registration_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_registration: {
        Args: { p_registration_id: string }
        Returns: {
          answers: Json
          confirmed_at: string | null
          created_at: string
          created_by: string
          currency: string | null
          division_id: string
          event_id: string
          id: string
          price_cents: number | null
          status: Database["public"]["Enums"]["registration_status"]
          submitted_at: string | null
          team_id: string | null
          team_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirmar_pago_manual: {
        Args: { p_order_id: string; p_referencia?: string }
        Returns: {
          amount_cents: number
          created_at: string
          currency: string
          discount_cents: number
          discount_code_id: string | null
          event_id: string
          id: string
          paid_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          registration_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cupos_disponibles: { Args: { p_division_id: string }; Returns: number }
      ensure_circuit_part: { Args: { p_event_id: string }; Returns: string }
      ensure_my_organization: {
        Args: never
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          plan: Database["public"]["Enums"]["org_plan"]
          slug: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      es_integrante_de: {
        Args: { p_registration_id: string }
        Returns: boolean
      }
      evaluar_descuento: {
        Args: {
          p_code: string
          p_division_id: string
          p_event_id: string
          p_monto_cents: number
        }
        Returns: {
          code_id: string
          descuento_cents: number
          motivo: string
        }[]
      }
      event_config_issues: {
        Args: { p_event_id: string }
        Returns: {
          code: string
          detail: string
          severity: string
        }[]
      }
      event_plan_status: { Args: { p_event_id: string }; Returns: Json }
      event_role: {
        Args: { p_event_id: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      event_schedule_issues: {
        Args: { p_event_id: string }
        Returns: {
          code: string
          detail: string
          severity: string
        }[]
      }
      event_staff_role: {
        Args: { p_event_id: string }
        Returns: Database["public"]["Enums"]["event_staff_role"]
      }
      evento_de_inscripcion: {
        Args: { p_registration_id: string }
        Returns: string
      }
      guardar_medio_de_cobro: {
        Args: {
          p_billing_email?: string
          p_card_brand?: string
          p_card_exp_month?: number
          p_card_exp_year?: number
          p_card_last4?: string
          p_card_token: string
          p_holder_name?: string
          p_org_id: string
          p_provider: string
          p_tax_id?: string
        }
        Returns: undefined
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
      inscripcion_abierta: { Args: { p_division_id: string }; Returns: boolean }
      invite_event_staff: {
        Args: {
          p_can_delete_registrations?: boolean
          p_can_edit_registrations?: boolean
          p_can_edit_scores?: boolean
          p_can_manage_workouts?: boolean
          p_divisions?: string[]
          p_email: string
          p_event_id: string
          p_is_admin?: boolean
          p_role?: Database["public"]["Enums"]["event_staff_role"]
        }
        Returns: {
          accepted_at: string | null
          approved_at: string | null
          can_delete_registrations: boolean
          can_edit_registrations: boolean
          can_edit_scores: boolean
          can_manage_workouts: boolean
          created_at: string
          event_id: string
          id: string
          invited_by: string | null
          invited_email: string
          is_admin: boolean
          role: Database["public"]["Enums"]["event_staff_role"]
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "event_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      invite_member: {
        Args: { p_email: string; p_position: number; p_registration_id: string }
        Returns: {
          accepted_terms_at: string | null
          answers: Json
          birth_date: string | null
          box: string | null
          country: string | null
          created_at: string
          document_id: string | null
          event_id: string
          first_name: string | null
          gender: Database["public"]["Enums"]["athlete_gender"] | null
          id: string
          invited_email: string
          last_name: string | null
          phone: string | null
          position: number
          profile_id: string | null
          registration_id: string
          shirt_size: string | null
          state_province: string | null
          status: Database["public"]["Enums"]["registration_member_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registration_members"
          isOneToOne: true
          isSetofReturn: false
        }
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
      judge_lane_bundle: {
        Args: { p_lane_id: string }
        Returns: {
          athletes: string
          bib_number: number
          course_template_id: string
          division_id: string
          division_name: string
          event_id: string
          event_name: string
          heat_id: string
          heat_name: string
          heat_started_at: string
          judge_id: string
          lane_number: number
          start_offset_ms: number
          team_name: string
          workout_id: string
        }[]
      }
      judge_visible_lanes: {
        Args: never
        Returns: {
          athletes: string
          bib_number: number
          division_name: string
          event_id: string
          event_name: string
          event_status: Database["public"]["Enums"]["event_status"]
          heat_id: string
          heat_name: string
          heat_started_at: string
          judge_id: string
          lane_id: string
          lane_number: number
          status: Database["public"]["Enums"]["lane_status"]
          team_id: string
          team_name: string
        }[]
      }
      medios_de_pago: { Args: { p_registration_id: string }; Returns: Json }
      org_staff_directory: {
        Args: { p_event_id: string }
        Returns: {
          email: string
          fue_juez: boolean
          nombre: string
          ultima_competencia: string
          ultima_fecha: string
          user_id: string
          veces: number
        }[]
      }
      public_catalog_filters: { Args: never; Returns: Json }
      public_event_detail: { Args: { p_public_slug: string }; Returns: Json }
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
      public_events_catalog: {
        Args: {
          p_anio?: number
          p_busqueda?: string
          p_ciudad?: string
          p_desde?: string
          p_destacados?: boolean
          p_formato?: Database["public"]["Enums"]["event_format"]
          p_hasta?: string
          p_limite?: number
          p_mes?: number
          p_offset?: number
          p_pais?: string
          p_slugs?: string[]
        }
        Returns: {
          city: string
          country: string
          cover_url: string
          description: string
          destacado: boolean
          ends_at: string
          event_type: Database["public"]["Enums"]["event_type"]
          format: Database["public"]["Enums"]["event_format"]
          inscripciones_abiertas: boolean
          logo_url: string
          name: string
          organizer_name: string
          public_slug: string
          registration_closes_at: string
          registration_opens_at: string
          starts_at: string
          state: string
          timezone: string
          total: number
          venue: string
        }[]
      }
      public_judge_application_status: {
        Args: { p_public_slug: string }
        Returns: string
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
      public_participants: { Args: { p_public_slug: string }; Returns: Json }
      public_registration_form: {
        Args: { p_public_slug: string }
        Returns: Json
      }
      public_scoreboard: { Args: { p_public_slug: string }; Returns: Json }
      publish_event: {
        Args: { p_event_id: string }
        Returns: {
          address: string | null
          allow_judge_self_claim: boolean
          auto_tiebreak: boolean
          city: string | null
          country: string | null
          cover_url: string | null
          created_at: string
          currency: string
          description: string | null
          ends_at: string | null
          event_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          featured_at: string | null
          format: Database["public"]["Enums"]["event_format"]
          id: string
          instagram: string | null
          logo_url: string | null
          name: string
          org_id: string
          organizer_name: string | null
          organizer_phone: string | null
          organizer_phone_country: string | null
          public_slug: string
          published_at: string | null
          registration_closes_at: string | null
          registration_opens_at: string | null
          shirt_sizes: string[]
          starts_at: string | null
          state: string | null
          status: Database["public"]["Enums"]["event_status"]
          timezone: string
          updated_at: string
          venue: string | null
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
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
          snapshot_version: number
        }
        SetofOptions: {
          from: "*"
          to: "result_publications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      puede_en_division: {
        Args: { p_division_id: string; p_event_id: string }
        Returns: boolean
      }
      puede_leer_evento: { Args: { p_event_id: string }; Returns: boolean }
      puede_ver_inscripcion: {
        Args: { p_registration_id: string }
        Returns: boolean
      }
      registrar_intento_de_pago: {
        Args: {
          p_amount_cents?: number
          p_external_id?: string
          p_order_id: string
          p_provider: Database["public"]["Enums"]["payment_provider"]
          p_raw?: Json
          p_status: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          currency: string
          discount_cents: number
          discount_code_id: string | null
          event_id: string
          id: string
          paid_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          registration_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_event_staff: { Args: { p_staff_id: string }; Returns: undefined }
      remove_org_member: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      reorder_segments: {
        Args: { p_ordered_ids: string[]; p_template_id: string }
        Returns: undefined
      }
      save_member_data: {
        Args: { p_datos: Json; p_member_id: string }
        Returns: {
          accepted_terms_at: string | null
          answers: Json
          birth_date: string | null
          box: string | null
          country: string | null
          created_at: string
          document_id: string | null
          event_id: string
          first_name: string | null
          gender: Database["public"]["Enums"]["athlete_gender"] | null
          id: string
          invited_email: string
          last_name: string | null
          phone: string | null
          position: number
          profile_id: string | null
          registration_id: string
          shirt_size: string | null
          state_province: string | null
          status: Database["public"]["Enums"]["registration_member_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registration_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      scoreboard_document: {
        Args: { p_detalle?: boolean; p_event_id: string }
        Returns: Json
      }
      set_team_approval: {
        Args: { p_approved: boolean; p_team_id: string }
        Returns: {
          approved: boolean
          bib_number: number
          created_at: string
          division_id: string
          event_id: string
          id: string
          name: string | null
          status: Database["public"]["Enums"]["team_status"]
        }
        SetofOptions: {
          from: "*"
          to: "teams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shares_org_with: { Args: { p_user_id: string }; Returns: boolean }
      start_heat: {
        Args: { p_heat_id: string }
        Returns: {
          arena_id: string | null
          created_at: string
          division_id: string | null
          ended_at: string | null
          event_id: string
          id: string
          lane_count: number
          name: string
          scheduled_at: string | null
          scheduled_end_at: string | null
          start_source: Database["public"]["Enums"]["start_source"] | null
          started_at: string | null
          started_by: string | null
          status: Database["public"]["Enums"]["heat_status"]
          workout_id: string
        }
        SetofOptions: {
          from: "*"
          to: "heats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_registration: {
        Args: { p_division_id: string; p_team_name?: string }
        Returns: {
          answers: Json
          confirmed_at: string | null
          created_at: string
          created_by: string
          currency: string | null
          division_id: string
          event_id: string
          id: string
          price_cents: number | null
          status: Database["public"]["Enums"]["registration_status"]
          submitted_at: string | null
          team_id: string | null
          team_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_registration: {
        Args: { p_registration_id: string }
        Returns: {
          answers: Json
          confirmed_at: string | null
          created_at: string
          created_by: string
          currency: string | null
          division_id: string
          event_id: string
          id: string
          price_cents: number | null
          status: Database["public"]["Enums"]["registration_status"]
          submitted_at: string | null
          team_id: string | null
          team_name: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "registrations"
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
          workout_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lanes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unpublish_event: {
        Args: { p_event_id: string }
        Returns: {
          address: string | null
          allow_judge_self_claim: boolean
          auto_tiebreak: boolean
          city: string | null
          country: string | null
          cover_url: string | null
          created_at: string
          currency: string
          description: string | null
          ends_at: string | null
          event_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          featured_at: string | null
          format: Database["public"]["Enums"]["event_format"]
          id: string
          instagram: string | null
          logo_url: string | null
          name: string
          org_id: string
          organizer_name: string | null
          organizer_phone: string | null
          organizer_phone_country: string | null
          public_slug: string
          published_at: string | null
          registration_closes_at: string | null
          registration_opens_at: string | null
          shirt_sizes: string[]
          starts_at: string | null
          state: string | null
          status: Database["public"]["Enums"]["event_status"]
          timezone: string
          updated_at: string
          venue: string | null
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_order: {
        Args: { p_code?: string; p_registration_id: string }
        Returns: {
          amount_cents: number
          created_at: string
          currency: string
          discount_cents: number
          discount_code_id: string | null
          event_id: string
          id: string
          paid_at: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          registration_id: string
          status: Database["public"]["Enums"]["order_status"]
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_workout_score: {
        Args: { p_part_id: string; p_score: Json; p_team_id: string }
        Returns: {
          division_id: string
          entered_at: string | null
          entered_by: string | null
          event_id: string
          lane_id: string | null
          part_id: string
          score_unit: Database["public"]["Enums"]["score_unit"]
          source: Database["public"]["Enums"]["capture_mode"]
          status: Database["public"]["Enums"]["score_status"]
          team_id: string
          tiebreak_value: number | null
          updated_at: string
          value_cap: number | null
          value_num: number | null
          value_reps: number | null
          verified_at: string | null
          verified_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "workout_scores"
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
      verify_workout_scores: {
        Args: { p_division_id?: string; p_event_id: string; p_part_id?: string }
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
      block_kind: "buy_in" | "trabajo" | "descanso" | "cash_out"
      capture_mode: "manual" | "en_vivo"
      discount_kind: "porcentaje" | "monto"
      event_document_kind: "terminos" | "reglamento" | "waiver" | "otro"
      event_format: "crossfit" | "carrera_hibrida" | "mixto"
      event_staff_role:
        | "manager"
        | "verifier"
        | "scorekeeper"
        | "registrar"
        | "judge"
      event_status: "draft" | "ready" | "live" | "verifying" | "published"
      event_type: "presencial" | "virtual"
      gender_rule: "male" | "female" | "mixed" | "any"
      heat_status: "scheduled" | "armed" | "running" | "finished"
      lane_status: "idle" | "running" | "finished" | "dnf" | "dq"
      load_unit: "kg" | "lb"
      movement_category:
        | "levantamiento"
        | "gimnastico"
        | "monoestructural"
        | "odd_object"
        | "otro"
      movement_unit: "reps" | "metros" | "calorias" | "segundos" | "kg"
      order_status:
        | "pendiente"
        | "pagada"
        | "fallida"
        | "reembolsada"
        | "vencida"
      org_plan: "free" | "pro"
      org_role: "owner" | "admin" | "head_judge" | "judge"
      payment_provider:
        | "transferencia"
        | "efectivo"
        | "paypal"
        | "mercadopago"
        | "addi"
      penalty_kind: "time_add" | "no_rep" | "dq"
      registration_field_type:
        | "texto"
        | "numero"
        | "seleccion"
        | "booleano"
        | "fecha"
      registration_member_status: "invitado" | "completo"
      registration_status:
        | "borrador"
        | "esperando_integrantes"
        | "esperando_pago"
        | "confirmada"
        | "cancelada"
        | "lista_espera"
      score_dir: "menor_gana" | "mayor_gana"
      score_status:
        | "pendiente"
        | "en_curso"
        | "valido"
        | "capeado"
        | "dnf"
        | "dq"
      score_unit:
        | "tiempo"
        | "reps"
        | "rondas"
        | "rondas_reps"
        | "carga"
        | "distancia"
        | "calorias"
        | "puntos"
      segment_kind: "run" | "station" | "transition"
      start_source: "server" | "device_offline"
      team_mode:
        | "individual"
        | "sincronizado"
        | "alternado"
        | "relevo"
        | "reparto_libre"
      team_status: "registered" | "checked_in" | "withdrawn"
      tiebreak_source: "hito" | "otra_prueba" | "manual"
      time_scheme:
        | "circuito"
        | "libre"
        | "cap"
        | "ventana"
        | "intervalos"
        | "sin_reloj"
      timing_event_type:
        | "lane_start"
        | "segment_split"
        | "penalty"
        | "undo"
        | "dnf"
        | "dq"
        | "note"
        | "rep"
        | "no_rep"
        | "movement_done"
        | "round_done"
        | "lift"
        | "tiebreak"
        | "time_cap"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      block_kind: ["buy_in", "trabajo", "descanso", "cash_out"],
      capture_mode: ["manual", "en_vivo"],
      discount_kind: ["porcentaje", "monto"],
      event_document_kind: ["terminos", "reglamento", "waiver", "otro"],
      event_format: ["crossfit", "carrera_hibrida", "mixto"],
      event_staff_role: [
        "manager",
        "verifier",
        "scorekeeper",
        "registrar",
        "judge",
      ],
      event_status: ["draft", "ready", "live", "verifying", "published"],
      event_type: ["presencial", "virtual"],
      gender_rule: ["male", "female", "mixed", "any"],
      heat_status: ["scheduled", "armed", "running", "finished"],
      lane_status: ["idle", "running", "finished", "dnf", "dq"],
      load_unit: ["kg", "lb"],
      movement_category: [
        "levantamiento",
        "gimnastico",
        "monoestructural",
        "odd_object",
        "otro",
      ],
      movement_unit: ["reps", "metros", "calorias", "segundos", "kg"],
      order_status: [
        "pendiente",
        "pagada",
        "fallida",
        "reembolsada",
        "vencida",
      ],
      org_plan: ["free", "pro"],
      org_role: ["owner", "admin", "head_judge", "judge"],
      payment_provider: [
        "transferencia",
        "efectivo",
        "paypal",
        "mercadopago",
        "addi",
      ],
      penalty_kind: ["time_add", "no_rep", "dq"],
      registration_field_type: [
        "texto",
        "numero",
        "seleccion",
        "booleano",
        "fecha",
      ],
      registration_member_status: ["invitado", "completo"],
      registration_status: [
        "borrador",
        "esperando_integrantes",
        "esperando_pago",
        "confirmada",
        "cancelada",
        "lista_espera",
      ],
      score_dir: ["menor_gana", "mayor_gana"],
      score_status: ["pendiente", "en_curso", "valido", "capeado", "dnf", "dq"],
      score_unit: [
        "tiempo",
        "reps",
        "rondas",
        "rondas_reps",
        "carga",
        "distancia",
        "calorias",
        "puntos",
      ],
      segment_kind: ["run", "station", "transition"],
      start_source: ["server", "device_offline"],
      team_mode: [
        "individual",
        "sincronizado",
        "alternado",
        "relevo",
        "reparto_libre",
      ],
      team_status: ["registered", "checked_in", "withdrawn"],
      tiebreak_source: ["hito", "otra_prueba", "manual"],
      time_scheme: [
        "circuito",
        "libre",
        "cap",
        "ventana",
        "intervalos",
        "sin_reloj",
      ],
      timing_event_type: [
        "lane_start",
        "segment_split",
        "penalty",
        "undo",
        "dnf",
        "dq",
        "note",
        "rep",
        "no_rep",
        "movement_done",
        "round_done",
        "lift",
        "tiebreak",
        "time_cap",
      ],
    },
  },
} as const
