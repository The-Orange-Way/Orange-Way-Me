export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          connector_type: Database["public"]["Enums"]["connector_type"];
          created_at: string;
          dek_key_version: number;
          enc_balance: string;
          enc_currency: string;
          enc_institution: string | null;
          enc_metadata: string | null;
          enc_name: string;
          enc_type: string;
          household_id: string | null;
          id: string;
          is_active: boolean;
          opened_at: string;
          provider_slug: string | null;
          scope: string;
          signature_b64: string | null;
          signature_key_version: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connector_type?: Database["public"]["Enums"]["connector_type"];
          created_at?: string;
          dek_key_version?: number;
          enc_balance: string;
          enc_currency: string;
          enc_institution?: string | null;
          enc_metadata?: string | null;
          enc_name: string;
          enc_type: string;
          household_id?: string | null;
          id?: string;
          is_active?: boolean;
          opened_at?: string;
          provider_slug?: string | null;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connector_type?: Database["public"]["Enums"]["connector_type"];
          created_at?: string;
          dek_key_version?: number;
          enc_balance?: string;
          enc_currency?: string;
          enc_institution?: string | null;
          enc_metadata?: string | null;
          enc_name?: string;
          enc_type?: string;
          household_id?: string | null;
          id?: string;
          is_active?: boolean;
          opened_at?: string;
          provider_slug?: string | null;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      beta_applications: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          note: string | null;
          owns_btc: boolean;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          note?: string | null;
          owns_btc?: boolean;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          note?: string | null;
          owns_btc?: boolean;
        };
        Relationships: [];
      };
      budgets: {
        Row: {
          created_at: string;
          dek_key_version: number;
          enc_data: string;
          enc_mode: string;
          household_id: string | null;
          id: string;
          month: string;
          scope: string;
          signature_b64: string | null;
          signature_key_version: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          dek_key_version?: number;
          enc_data: string;
          enc_mode: string;
          household_id?: string | null;
          id?: string;
          month: string;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          dek_key_version?: number;
          enc_data?: string;
          enc_mode?: string;
          household_id?: string | null;
          id?: string;
          month?: string;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          dek_key_version: number;
          enc_color: string | null;
          enc_icon: string | null;
          enc_name: string;
          enc_parent_id: string | null;
          household_id: string | null;
          id: string;
          scope: string;
          signature_b64: string | null;
          signature_key_version: number | null;
          sort_order: number;
          type: Database["public"]["Enums"]["category_type"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          dek_key_version?: number;
          enc_color?: string | null;
          enc_icon?: string | null;
          enc_name: string;
          enc_parent_id?: string | null;
          household_id?: string | null;
          id?: string;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          sort_order?: number;
          type?: Database["public"]["Enums"]["category_type"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          dek_key_version?: number;
          enc_color?: string | null;
          enc_icon?: string | null;
          enc_name?: string;
          enc_parent_id?: string | null;
          household_id?: string | null;
          id?: string;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          sort_order?: number;
          type?: Database["public"]["Enums"]["category_type"];
          user_id?: string;
        };
        Relationships: [];
      };
      connection_account_map: {
        Row: {
          created_at: string;
          encrypted_account_id: string;
          encrypted_metadata_key_version: number;
          id: string;
          is_active: boolean;
          or_connection_id: string;
          or_external_wallet_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_account_id: string;
          encrypted_metadata_key_version?: number;
          id?: string;
          is_active?: boolean;
          or_connection_id: string;
          or_external_wallet_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_account_id?: string;
          encrypted_metadata_key_version?: number;
          id?: string;
          is_active?: boolean;
          or_connection_id?: string;
          or_external_wallet_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      connector_credentials: {
        Row: {
          account_id: string | null;
          connector_type: Database["public"]["Enums"]["connector_type"];
          created_at: string;
          enc_credentials: string;
          id: string;
          user_id: string;
        };
        Insert: {
          account_id?: string | null;
          connector_type: Database["public"]["Enums"]["connector_type"];
          created_at?: string;
          enc_credentials: string;
          id?: string;
          user_id: string;
        };
        Update: {
          account_id?: string | null;
          connector_type?: Database["public"]["Enums"]["connector_type"];
          created_at?: string;
          enc_credentials?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "connector_credentials_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: {
          created_at: string;
          dek_key_version: number;
          enc_current_amount: string;
          enc_interest_rate: string | null;
          enc_linked_account_ids: string | null;
          enc_manual_allocation: string | null;
          enc_minimum_payment: string | null;
          enc_name: string;
          enc_starting_balance: string | null;
          enc_strategy: string | null;
          enc_target_amount: string;
          enc_target_date: string | null;
          enc_type: string;
          household_id: string | null;
          id: string;
          is_completed: boolean;
          scope: string;
          signature_b64: string | null;
          signature_key_version: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          dek_key_version?: number;
          enc_current_amount: string;
          enc_interest_rate?: string | null;
          enc_linked_account_ids?: string | null;
          enc_manual_allocation?: string | null;
          enc_minimum_payment?: string | null;
          enc_name: string;
          enc_starting_balance?: string | null;
          enc_strategy?: string | null;
          enc_target_amount: string;
          enc_target_date?: string | null;
          enc_type: string;
          household_id?: string | null;
          id?: string;
          is_completed?: boolean;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          dek_key_version?: number;
          enc_current_amount?: string;
          enc_interest_rate?: string | null;
          enc_linked_account_ids?: string | null;
          enc_manual_allocation?: string | null;
          enc_minimum_payment?: string | null;
          enc_name?: string;
          enc_starting_balance?: string | null;
          enc_strategy?: string | null;
          enc_target_amount?: string;
          enc_target_date?: string | null;
          enc_type?: string;
          household_id?: string | null;
          id?: string;
          is_completed?: boolean;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      household_active_key_versions: {
        Row: {
          active_dek_key_version: number;
          household_id: string;
          last_rotated_at: string;
        };
        Insert: {
          active_dek_key_version?: number;
          household_id: string;
          last_rotated_at?: string;
        };
        Update: {
          active_dek_key_version?: number;
          household_id?: string;
          last_rotated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_active_key_versions_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: true;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_invites: {
        Row: {
          code: string;
          created_at: string;
          email: string | null;
          email_hash: string | null;
          expires_at: string;
          household_id: string;
          id: string;
          inviter_id: string | null;
          ready_to_wrap_at: string | null;
          recipient_user_id: string | null;
          revoked_at: string | null;
          role: string;
          status: string;
          used_at: string | null;
          used_by: string | null;
          wrapped_at: string | null;
        };
        Insert: {
          code?: string;
          created_at?: string;
          email?: string | null;
          email_hash?: string | null;
          expires_at?: string;
          household_id: string;
          id?: string;
          inviter_id?: string | null;
          ready_to_wrap_at?: string | null;
          recipient_user_id?: string | null;
          revoked_at?: string | null;
          role?: string;
          status?: string;
          used_at?: string | null;
          used_by?: string | null;
          wrapped_at?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          email?: string | null;
          email_hash?: string | null;
          expires_at?: string;
          household_id?: string;
          id?: string;
          inviter_id?: string | null;
          ready_to_wrap_at?: string | null;
          recipient_user_id?: string | null;
          revoked_at?: string | null;
          role?: string;
          status?: string;
          used_at?: string | null;
          used_by?: string | null;
          wrapped_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_key_rotation_jobs: {
        Row: {
          abort_reason: string | null;
          completed_at: string | null;
          error_log: Json;
          household_id: string;
          id: string;
          new_dek_key_version: number;
          previous_dek_key_version: number | null;
          refresh_mode: string;
          rollback_expires_at: string | null;
          rows_failed: number;
          rows_processed: number;
          rows_total: number;
          started_at: string;
          started_by: string;
          status: string;
          trigger_type: string;
        };
        Insert: {
          abort_reason?: string | null;
          completed_at?: string | null;
          error_log?: Json;
          household_id: string;
          id?: string;
          new_dek_key_version: number;
          previous_dek_key_version?: number | null;
          refresh_mode?: string;
          rollback_expires_at?: string | null;
          rows_failed?: number;
          rows_processed?: number;
          rows_total?: number;
          started_at?: string;
          started_by: string;
          status?: string;
          trigger_type: string;
        };
        Update: {
          abort_reason?: string | null;
          completed_at?: string | null;
          error_log?: Json;
          household_id?: string;
          id?: string;
          new_dek_key_version?: number;
          previous_dek_key_version?: number | null;
          refresh_mode?: string;
          rollback_expires_at?: string | null;
          rows_failed?: number;
          rows_processed?: number;
          rows_total?: number;
          started_at?: string;
          started_by?: string;
          status?: string;
          trigger_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_key_rotation_jobs_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_keys: {
        Row: {
          created_at: string;
          enc_household_dek: string;
          household_id: string;
          id: string;
          is_placeholder: boolean;
          key_version: number;
          revoked_at: string | null;
          user_id: string;
          wrap_algo: string;
          wrapped_by: string | null;
        };
        Insert: {
          created_at?: string;
          enc_household_dek: string;
          household_id: string;
          id?: string;
          is_placeholder?: boolean;
          key_version?: number;
          revoked_at?: string | null;
          user_id: string;
          wrap_algo?: string;
          wrapped_by?: string | null;
        };
        Update: {
          created_at?: string;
          enc_household_dek?: string;
          household_id?: string;
          id?: string;
          is_placeholder?: boolean;
          key_version?: number;
          revoked_at?: string | null;
          user_id?: string;
          wrap_algo?: string;
          wrapped_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_keys_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_member_osk_wraps: {
        Row: {
          created_at: string;
          household_id: string;
          iv: string;
          key_version: number;
          user_id: string;
          wrap_algo: string;
          wrapped_private_key: string;
        };
        Insert: {
          created_at?: string;
          household_id: string;
          iv: string;
          key_version?: number;
          user_id: string;
          wrap_algo?: string;
          wrapped_private_key: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          iv?: string;
          key_version?: number;
          user_id?: string;
          wrap_algo?: string;
          wrapped_private_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_member_osk_wraps_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_members: {
        Row: {
          email_hash: string | null;
          enc_email: string | null;
          expires_at: string | null;
          household_id: string;
          id: string;
          invited_at: string;
          joined_at: string | null;
          revoked_at: string | null;
          role: string;
          source: string;
          status: string;
          user_id: string | null;
        };
        Insert: {
          email_hash?: string | null;
          enc_email?: string | null;
          expires_at?: string | null;
          household_id: string;
          id?: string;
          invited_at?: string;
          joined_at?: string | null;
          revoked_at?: string | null;
          role?: string;
          source?: string;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          email_hash?: string | null;
          enc_email?: string | null;
          expires_at?: string | null;
          household_id?: string;
          id?: string;
          invited_at?: string;
          joined_at?: string | null;
          revoked_at?: string | null;
          role?: string;
          source?: string;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_signing_keys: {
        Row: {
          algorithm: string;
          created_at: string;
          created_by: string;
          household_id: string;
          key_version: number;
          public_key_b64: string;
        };
        Insert: {
          algorithm?: string;
          created_at?: string;
          created_by: string;
          household_id: string;
          key_version?: number;
          public_key_b64: string;
        };
        Update: {
          algorithm?: string;
          created_at?: string;
          created_by?: string;
          household_id?: string;
          key_version?: number;
          public_key_b64?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_signing_keys_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          btc_display_mode: string;
          created_at: string;
          enc_name: string;
          id: string;
          owner_id: string;
          primary_currency: string;
          reporting_currency: string;
        };
        Insert: {
          btc_display_mode?: string;
          created_at?: string;
          enc_name: string;
          id?: string;
          owner_id: string;
          primary_currency?: string;
          reporting_currency?: string;
        };
        Update: {
          btc_display_mode?: string;
          created_at?: string;
          enc_name?: string;
          id?: string;
          owner_id?: string;
          primary_currency?: string;
          reporting_currency?: string;
        };
        Relationships: [];
      };
      pending_admin_emails: {
        Row: {
          body: string;
          household_id: string | null;
          id: string;
          kind: string;
          queued_at: string;
          send_error: string | null;
          sent_at: string | null;
          subject: string;
          user_id: string | null;
        };
        Insert: {
          body: string;
          household_id?: string | null;
          id?: string;
          kind: string;
          queued_at?: string;
          send_error?: string | null;
          sent_at?: string | null;
          subject: string;
          user_id?: string | null;
        };
        Update: {
          body?: string;
          household_id?: string | null;
          id?: string;
          kind?: string;
          queued_at?: string;
          send_error?: string | null;
          sent_at?: string | null;
          subject?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pending_admin_emails_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      rules: {
        Row: {
          created_at: string;
          dek_key_version: number;
          enc_actions: string;
          enc_conditions: string;
          enc_name: string;
          fire_count: number;
          household_id: string | null;
          id: string;
          is_enabled: boolean;
          last_fired_at: string | null;
          match_mode: string;
          scope: string;
          signature_b64: string | null;
          signature_key_version: number | null;
          sort_order: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          dek_key_version?: number;
          enc_actions: string;
          enc_conditions: string;
          enc_name: string;
          fire_count?: number;
          household_id?: string | null;
          id?: string;
          is_enabled?: boolean;
          last_fired_at?: string | null;
          match_mode?: string;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          sort_order?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          dek_key_version?: number;
          enc_actions?: string;
          enc_conditions?: string;
          enc_name?: string;
          fire_count?: number;
          household_id?: string | null;
          id?: string;
          is_enabled?: boolean;
          last_fired_at?: string | null;
          match_mode?: string;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          sort_order?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      support_sessions: {
        Row: {
          end_reason: string | null;
          ended_at: string | null;
          expires_at: string;
          granted_at: string;
          granted_by: string;
          household_id: string;
          id: string;
          support_user_id: string;
        };
        Insert: {
          end_reason?: string | null;
          ended_at?: string | null;
          expires_at: string;
          granted_at?: string;
          granted_by: string;
          household_id: string;
          id?: string;
          support_user_id: string;
        };
        Update: {
          end_reason?: string | null;
          ended_at?: string | null;
          expires_at?: string;
          granted_at?: string;
          granted_by?: string;
          household_id?: string;
          id?: string;
          support_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_sessions_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      sync_events: {
        Row: {
          id: number;
          or_connection_id: string;
          or_event_id: string | null;
          or_ts: string;
          received_at: string;
          synced_count: number;
          user_id: string;
        };
        Insert: {
          id?: number;
          or_connection_id: string;
          or_event_id?: string | null;
          or_ts: string;
          received_at?: string;
          synced_count?: number;
          user_id: string;
        };
        Update: {
          id?: number;
          or_connection_id?: string;
          or_event_id?: string | null;
          or_ts?: string;
          received_at?: string;
          synced_count?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          account_id: string;
          cleared_status: string | null;
          created_at: string;
          date: string;
          dek_key_version: number;
          enc_amount: string;
          enc_category_id: string | null;
          enc_currency: string | null;
          enc_description: string;
          enc_memo: string | null;
          enc_merchant: string | null;
          enc_owner: string | null;
          enc_tags: string | null;
          external_id: string | null;
          external_source: string | null;
          hmac_category: string | null;
          hmac_merchant: string | null;
          household_id: string | null;
          id: string;
          is_manual_category: boolean;
          is_split_parent: boolean;
          scope: string;
          signature_b64: string | null;
          signature_key_version: number | null;
          split_parent_id: string | null;
          transfer_group_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          account_id: string;
          cleared_status?: string | null;
          created_at?: string;
          date: string;
          dek_key_version?: number;
          enc_amount: string;
          enc_category_id?: string | null;
          enc_currency?: string | null;
          enc_description: string;
          enc_memo?: string | null;
          enc_merchant?: string | null;
          enc_owner?: string | null;
          enc_tags?: string | null;
          external_id?: string | null;
          external_source?: string | null;
          hmac_category?: string | null;
          hmac_merchant?: string | null;
          household_id?: string | null;
          id?: string;
          is_manual_category?: boolean;
          is_split_parent?: boolean;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          split_parent_id?: string | null;
          transfer_group_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          account_id?: string;
          cleared_status?: string | null;
          created_at?: string;
          date?: string;
          dek_key_version?: number;
          enc_amount?: string;
          enc_category_id?: string | null;
          enc_currency?: string | null;
          enc_description?: string;
          enc_memo?: string | null;
          enc_merchant?: string | null;
          enc_owner?: string | null;
          enc_tags?: string | null;
          external_id?: string | null;
          external_source?: string | null;
          hmac_category?: string | null;
          hmac_merchant?: string | null;
          household_id?: string | null;
          id?: string;
          is_manual_category?: boolean;
          is_split_parent?: boolean;
          scope?: string;
          signature_b64?: string | null;
          signature_key_version?: number | null;
          split_parent_id?: string | null;
          transfer_group_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_split_parent_id_fkey";
            columns: ["split_parent_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      user_last_seen_household_key_versions: {
        Row: {
          dek_key_version: number;
          household_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          dek_key_version?: number;
          household_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          dek_key_version?: number;
          household_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_last_seen_household_key_versions_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      user_profiles: {
        Row: {
          avatar_url: string | null;
          enc_display_name: string | null;
          // hand-added ahead of next `supabase gen types` pass
          has_seen_dashboard_tour: boolean;
          or_subaccount_id: string | null;
          quiltt_session_expires_at: string | null;
          quiltt_session_token: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_url?: string | null;
          enc_display_name?: string | null;
          // hand-added ahead of next `supabase gen types` pass
          has_seen_dashboard_tour?: boolean;
          or_subaccount_id?: string | null;
          quiltt_session_expires_at?: string | null;
          quiltt_session_token?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          enc_display_name?: string | null;
          // hand-added ahead of next `supabase gen types` pass
          has_seen_dashboard_tour?: boolean;
          or_subaccount_id?: string | null;
          quiltt_session_expires_at?: string | null;
          quiltt_session_token?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_public_keys: {
        Row: {
          algorithm: string;
          created_at: string;
          public_key_b64: string;
          user_id: string;
        };
        Insert: {
          algorithm?: string;
          created_at?: string;
          public_key_b64: string;
          user_id: string;
        };
        Update: {
          algorithm?: string;
          created_at?: string;
          public_key_b64?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      vault_metadata: {
        Row: {
          created_at: string;
          enc_hmac_key: string | null;
          enc_mek_ciphertext: string | null;
          enc_private_key: string | null;
          hmac_salt: string;
          kdf_iterations: number;
          kdf_salt: string;
          recovery_ciphertext: string | null;
          user_id: string;
          vault_key_version: number;
          verifier_ciphertext: string;
        };
        Insert: {
          created_at?: string;
          enc_hmac_key?: string | null;
          enc_mek_ciphertext?: string | null;
          enc_private_key?: string | null;
          hmac_salt: string;
          kdf_iterations?: number;
          kdf_salt: string;
          recovery_ciphertext?: string | null;
          user_id: string;
          vault_key_version?: number;
          verifier_ciphertext: string;
        };
        Update: {
          created_at?: string;
          enc_hmac_key?: string | null;
          enc_mek_ciphertext?: string | null;
          enc_private_key?: string | null;
          hmac_salt?: string;
          kdf_iterations?: number;
          kdf_salt?: string;
          recovery_ciphertext?: string | null;
          user_id?: string;
          vault_key_version?: number;
          verifier_ciphertext?: string;
        };
        Relationships: [];
      };
      vault_security_events: {
        Row: {
          created_at: string;
          event: string;
          id: string;
          metadata: Json | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event: string;
          id?: string;
          metadata?: Json | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event?: string;
          id?: string;
          metadata?: Json | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      advance_household_rotation_job: {
        Args: { p_job_id: string; p_new_status: string };
        Returns: undefined;
      };
      expire_time_boxed_household_roles: {
        Args: never;
        Returns: {
          expired_roles: number;
          expired_sessions: number;
        }[];
      };
      find_user_id_by_email: { Args: { p_email: string }; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      pqc_verify_ml_dsa_65: {
        Args: {
          p_payload: string;
          p_public_key_b64: string;
          p_signature_b64: string;
        };
        Returns: boolean;
      };
      purge_expired_old_household_key_wraps: { Args: never; Returns: number };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
      category_type: "income" | "expense" | "transfer";
      connector_type: "manual" | "csv" | "xpub" | "simplefin" | "orange_rails";
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      category_type: ["income", "expense", "transfer"],
      connector_type: ["manual", "csv", "xpub", "simplefin", "orange_rails"],
    },
  },
} as const;
