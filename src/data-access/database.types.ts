export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_emails: {
        Row: {
          created_at: string
          email: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_emails_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_invites: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          expires_at: string
          id: string
          issued_at: string
          issued_by: string
          profile_id: string
          superseded_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          expires_at: string
          id?: string
          issued_at?: string
          issued_by: string
          profile_id: string
          superseded_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          expires_at?: string
          id?: string
          issued_at?: string
          issued_by?: string
          profile_id?: string
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_invites_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_invites_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_responses: {
        Row: {
          alert_id: string
          created_at: string
          id: string
          message: string
          responder_profile_id: string
        }
        Insert: {
          alert_id: string
          created_at?: string
          id?: string
          message: string
          responder_profile_id: string
        }
        Update: {
          alert_id?: string
          created_at?: string
          id?: string
          message?: string
          responder_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_responses_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_responses_responder_profile_id_fkey"
            columns: ["responder_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          category: Database["public"]["Enums"]["alert_category"]
          created_at: string
          id: string
          message: string
          outlet_id: string
          priority: Database["public"]["Enums"]["alert_priority"]
          raised_by: string
          status: Database["public"]["Enums"]["alert_status"]
          subject: string
        }
        Insert: {
          category: Database["public"]["Enums"]["alert_category"]
          created_at?: string
          id?: string
          message: string
          outlet_id: string
          priority?: Database["public"]["Enums"]["alert_priority"]
          raised_by: string
          status?: Database["public"]["Enums"]["alert_status"]
          subject: string
        }
        Update: {
          category?: Database["public"]["Enums"]["alert_category"]
          created_at?: string
          id?: string
          message?: string
          outlet_id?: string
          priority?: Database["public"]["Enums"]["alert_priority"]
          raised_by?: string
          status?: Database["public"]["Enums"]["alert_status"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          created_at: string
          ended_on: string | null
          id: string
          outlet_id: string | null
          person_id: string
          role: Database["public"]["Enums"]["app_role"]
          started_on: string
        }
        Insert: {
          created_at?: string
          ended_on?: string | null
          id?: string
          outlet_id?: string | null
          person_id: string
          role: Database["public"]["Enums"]["app_role"]
          started_on?: string
        }
        Update: {
          created_at?: string
          ended_on?: string | null
          id?: string
          outlet_id?: string | null
          person_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          started_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approver_accuracy_m: number | null
          approver_distance_m: number | null
          approver_lat: number | null
          approver_lng: number | null
          arrival_deadline: string | null
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_entered_by: string | null
          check_in_entered_by_name: string | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          created_at: string
          current_attempt_id: string | null
          id: string
          latest_decision_id: string | null
          outcome_attempt_id: string | null
          outlet_id: string
          person_id: string
          retry_blocked: boolean
          state_version: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        Insert: {
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          approver_accuracy_m?: number | null
          approver_distance_m?: number | null
          approver_lat?: number | null
          approver_lng?: number | null
          arrival_deadline?: string | null
          business_date: string
          check_in_accuracy_m?: number | null
          check_in_at?: string | null
          check_in_distance_m?: number | null
          check_in_entered_by?: string | null
          check_in_entered_by_name?: string | null
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_in_source?:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          created_at?: string
          current_attempt_id?: string | null
          id?: string
          latest_decision_id?: string | null
          outcome_attempt_id?: string | null
          outlet_id: string
          person_id: string
          retry_blocked?: boolean
          state_version?: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        Update: {
          approval_reason?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          approver_accuracy_m?: number | null
          approver_distance_m?: number | null
          approver_lat?: number | null
          approver_lng?: number | null
          arrival_deadline?: string | null
          business_date?: string
          check_in_accuracy_m?: number | null
          check_in_at?: string | null
          check_in_distance_m?: number | null
          check_in_entered_by?: string | null
          check_in_entered_by_name?: string | null
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_in_source?:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          created_at?: string
          current_attempt_id?: string | null
          id?: string
          latest_decision_id?: string | null
          outcome_attempt_id?: string | null
          outlet_id?: string
          person_id?: string
          retry_blocked?: boolean
          state_version?: number
          status?: Database["public"]["Enums"]["attendance_status"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_check_in_entered_by_fkey"
            columns: ["check_in_entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_current_attempt_fkey"
            columns: ["current_attempt_id"]
            isOneToOne: false
            referencedRelation: "attendance_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_current_attempt_same_day"
            columns: ["current_attempt_id", "id"]
            isOneToOne: false
            referencedRelation: "attendance_attempts"
            referencedColumns: ["id", "attendance_id"]
          },
          {
            foreignKeyName: "attendance_latest_decision_fkey"
            columns: ["latest_decision_id"]
            isOneToOne: false
            referencedRelation: "attendance_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_latest_decision_same_day"
            columns: ["latest_decision_id", "id"]
            isOneToOne: false
            referencedRelation: "attendance_decisions"
            referencedColumns: ["id", "attendance_id"]
          },
          {
            foreignKeyName: "attendance_outcome_attempt_fkey"
            columns: ["outcome_attempt_id"]
            isOneToOne: false
            referencedRelation: "attendance_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_outcome_attempt_same_day"
            columns: ["outcome_attempt_id", "id"]
            isOneToOne: false
            referencedRelation: "attendance_attempts"
            referencedColumns: ["id", "attendance_id"]
          },
          {
            foreignKeyName: "attendance_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_attempts: {
        Row: {
          accuracy_m: number | null
          arrival_deadline: string
          attempted_at: string
          attendance_id: string
          business_date: string
          created_at: string
          distance_m: number | null
          entered_by: string | null
          entered_by_name: string | null
          id: string
          latitude: number | null
          longitude: number | null
          outlet_id: string
          person_id: string
          request_fingerprint: string
          settled_at: string | null
          source: Database["public"]["Enums"]["check_in_source"]
          superseded_at: string | null
        }
        Insert: {
          accuracy_m?: number | null
          arrival_deadline: string
          attempted_at: string
          attendance_id: string
          business_date: string
          created_at?: string
          distance_m?: number | null
          entered_by?: string | null
          entered_by_name?: string | null
          id: string
          latitude?: number | null
          longitude?: number | null
          outlet_id: string
          person_id: string
          request_fingerprint: string
          settled_at?: string | null
          source: Database["public"]["Enums"]["check_in_source"]
          superseded_at?: string | null
        }
        Update: {
          accuracy_m?: number | null
          arrival_deadline?: string
          attempted_at?: string
          attendance_id?: string
          business_date?: string
          created_at?: string
          distance_m?: number | null
          entered_by?: string | null
          entered_by_name?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          outlet_id?: string
          person_id?: string
          request_fingerprint?: string
          settled_at?: string | null
          source?: Database["public"]["Enums"]["check_in_source"]
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_attempt_canonical_day"
            columns: ["attendance_id", "person_id", "business_date"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id", "person_id", "business_date"]
          },
          {
            foreignKeyName: "attendance_attempts_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_attempts_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_attempts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_attempts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_decisions: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          attempt_id: string | null
          attendance_id: string
          business_date: string
          created_at: string
          decided_at: string
          id: string
          kind: Database["public"]["Enums"]["attendance_decision_kind"]
          manager_accuracy_m: number | null
          manager_distance_m: number | null
          manager_lat: number | null
          manager_lng: number | null
          new_check_in_at: string | null
          new_status: Database["public"]["Enums"]["attendance_status"]
          outlet_id: string
          person_id: string
          prevents_retry: boolean
          previous_check_in_at: string | null
          previous_status: Database["public"]["Enums"]["attendance_status"]
          reason: string | null
          request_fingerprint: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          attempt_id?: string | null
          attendance_id: string
          business_date: string
          created_at?: string
          decided_at?: string
          id: string
          kind: Database["public"]["Enums"]["attendance_decision_kind"]
          manager_accuracy_m?: number | null
          manager_distance_m?: number | null
          manager_lat?: number | null
          manager_lng?: number | null
          new_check_in_at?: string | null
          new_status: Database["public"]["Enums"]["attendance_status"]
          outlet_id: string
          person_id: string
          prevents_retry: boolean
          previous_check_in_at?: string | null
          previous_status: Database["public"]["Enums"]["attendance_status"]
          reason?: string | null
          request_fingerprint: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          attempt_id?: string | null
          attendance_id?: string
          business_date?: string
          created_at?: string
          decided_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["attendance_decision_kind"]
          manager_accuracy_m?: number | null
          manager_distance_m?: number | null
          manager_lat?: number | null
          manager_lng?: number | null
          new_check_in_at?: string | null
          new_status?: Database["public"]["Enums"]["attendance_status"]
          outlet_id?: string
          person_id?: string
          prevents_retry?: boolean
          previous_check_in_at?: string | null
          previous_status?: Database["public"]["Enums"]["attendance_status"]
          reason?: string | null
          request_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_decision_attempt_same_day"
            columns: [
              "attempt_id",
              "attendance_id",
              "person_id",
              "business_date",
            ]
            isOneToOne: false
            referencedRelation: "attendance_attempts"
            referencedColumns: [
              "id",
              "attendance_id",
              "person_id",
              "business_date",
            ]
          },
          {
            foreignKeyName: "attendance_decision_canonical_day"
            columns: ["attendance_id", "person_id", "business_date"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id", "person_id", "business_date"]
          },
          {
            foreignKeyName: "attendance_decisions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_decisions_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_decisions_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_decisions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_items: {
        Row: {
          bill_id: string
          id: string
          item_name: string
          line_total_paise: number
          menu_item_id: string | null
          quantity: number
          unit_price_paise: number
        }
        Insert: {
          bill_id: string
          id?: string
          item_name: string
          line_total_paise: number
          menu_item_id?: string | null
          quantity: number
          unit_price_paise: number
        }
        Update: {
          bill_id?: string
          id?: string
          item_name?: string
          line_total_paise?: number
          menu_item_id?: string | null
          quantity?: number
          unit_price_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_number_counters: {
        Row: {
          last_number: number
          outlet_id: string
        }
        Insert: {
          last_number?: number
          outlet_id: string
        }
        Update: {
          last_number?: number
          outlet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_number_counters_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: true
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          bill_number: number
          biller_profile_id: string
          business_date: string
          counter_device_id: string
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          discount_paise: number
          id: string
          outlet_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          shift_id: string
          status: Database["public"]["Enums"]["bill_status"]
          subtotal_paise: number
          synced_at: string
          tax_paise: number
          total_paise: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          bill_number?: number
          biller_profile_id: string
          business_date: string
          counter_device_id: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_paise?: number
          id: string
          outlet_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"]
          shift_id: string
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal_paise: number
          synced_at?: string
          tax_paise?: number
          total_paise: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          bill_number?: number
          biller_profile_id?: string
          business_date?: string
          counter_device_id?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount_paise?: number
          id?: string
          outlet_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"]
          shift_id?: string
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal_paise?: number
          synced_at?: string
          tax_paise?: number
          total_paise?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bills_biller_profile_id_fkey"
            columns: ["biller_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_counter_device_id_fkey"
            columns: ["counter_device_id"]
            isOneToOne: false
            referencedRelation: "counter_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_withdrawals: {
        Row: {
          amount_paise: number
          business_date: string
          created_at: string
          id: string
          outlet_id: string
          reason: string | null
          recorded_by: string
          withdrawn_by: string
        }
        Insert: {
          amount_paise: number
          business_date: string
          created_at?: string
          id?: string
          outlet_id: string
          reason?: string | null
          recorded_by: string
          withdrawn_by: string
        }
        Update: {
          amount_paise?: number
          business_date?: string
          created_at?: string
          id?: string
          outlet_id?: string
          reason?: string | null
          recorded_by?: string
          withdrawn_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_withdrawals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_withdrawals_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      counter_devices: {
        Row: {
          enrolled_at: string
          enrolled_by: string | null
          id: string
          label: string
          last_seen_at: string | null
          outlet_id: string
          revoked_at: string | null
        }
        Insert: {
          enrolled_at?: string
          enrolled_by?: string | null
          id: string
          label: string
          last_seen_at?: string | null
          outlet_id: string
          revoked_at?: string | null
        }
        Update: {
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          label?: string
          last_seen_at?: string | null
          outlet_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "counter_devices_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "counter_devices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_lookup_attempts: {
        Row: {
          attempted_at: string
          caller_id: string | null
          id: number
        }
        Insert: {
          attempted_at?: string
          caller_id?: string | null
          id?: never
        }
        Update: {
          attempted_at?: string
          caller_id?: string | null
          id?: never
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          id: string
          last_used_at: string
          name: string | null
          phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string
          name?: string | null
          phone: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string
          name?: string | null
          phone?: string
        }
        Relationships: []
      }
      daily_cash_records: {
        Row: {
          actual_closing_paise: number
          business_date: string
          cash_expenses_paise: number
          cash_sales_paise: number
          cash_withdrawn_paise: number
          closed_at: string
          closed_by: string
          difference_paise: number
          expected_closing_paise: number
          id: string
          notes: string | null
          opening_cash_paise: number
          outlet_id: string
        }
        Insert: {
          actual_closing_paise: number
          business_date: string
          cash_expenses_paise: number
          cash_sales_paise: number
          cash_withdrawn_paise: number
          closed_at?: string
          closed_by: string
          difference_paise: number
          expected_closing_paise: number
          id?: string
          notes?: string | null
          opening_cash_paise: number
          outlet_id: string
        }
        Update: {
          actual_closing_paise?: number
          business_date?: string
          cash_expenses_paise?: number
          cash_sales_paise?: number
          cash_withdrawn_paise?: number
          closed_at?: string
          closed_by?: string
          difference_paise?: number
          expected_closing_paise?: number
          id?: string
          notes?: string | null
          opening_cash_paise?: number
          outlet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_cash_records_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_cash_records_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sign_in_attempts: {
        Row: {
          attempted_at: string
          email_hash: string
          id: number
          ip_hash: string | null
        }
        Insert: {
          attempted_at?: string
          email_hash: string
          id?: never
          ip_hash?: string | null
        }
        Update: {
          attempted_at?: string
          email_hash?: string
          id?: never
          ip_hash?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount_paise: number
          business_date: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          description: string | null
          id: string
          outlet_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
        }
        Insert: {
          amount_paise: number
          business_date: string
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          description?: string | null
          id?: string
          outlet_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string
        }
        Update: {
          amount_paise?: number
          business_date?: string
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          description?: string | null
          id?: string
          outlet_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          current_quantity: number
          id: string
          is_active: boolean
          last_updated_at: string
          low_stock_threshold: number
          name: string
          outlet_id: string
          purchase_cost_paise: number
          unit: Database["public"]["Enums"]["inventory_unit"]
        }
        Insert: {
          current_quantity?: number
          id?: string
          is_active?: boolean
          last_updated_at?: string
          low_stock_threshold?: number
          name: string
          outlet_id: string
          purchase_cost_paise?: number
          unit: Database["public"]["Enums"]["inventory_unit"]
        }
        Update: {
          current_quantity?: number
          id?: string
          is_active?: boolean
          last_updated_at?: string
          low_stock_threshold?: number
          name?: string
          outlet_id?: string
          purchase_cost_paise?: number
          unit?: Database["public"]["Enums"]["inventory_unit"]
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          business_date: string
          created_at: string
          id: string
          inventory_item_id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          note: string | null
          outlet_id: string
          quantity_delta: number
          recorded_by: string
          unit_cost_paise: number | null
        }
        Insert: {
          business_date: string
          created_at?: string
          id?: string
          inventory_item_id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          outlet_id: string
          quantity_delta: number
          recorded_by: string
          unit_cost_paise?: number | null
        }
        Update: {
          business_date?: string
          created_at?: string
          id?: string
          inventory_item_id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          outlet_id?: string
          quantity_delta?: number
          recorded_by?: string
          unit_cost_paise?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_redemption_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip_hash: string | null
        }
        Insert: {
          attempted_at?: string
          id?: never
          ip_hash?: string | null
        }
        Update: {
          attempted_at?: string
          id?: never
          ip_hash?: string | null
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          id: string
          is_active: boolean
          name: string
          outlet_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          is_active?: boolean
          name: string
          outlet_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          is_active?: boolean
          name?: string
          outlet_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          id: string
          is_available: boolean
          is_veg: boolean
          name: string
          outlet_id: string
          price_paise: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_available?: boolean
          is_veg?: boolean
          name: string
          outlet_id: string
          price_paise: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_available?: boolean
          is_veg?: boolean
          name?: string
          outlet_id?: string
          price_paise?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      outlets: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          arrival_deadline: string
          business_day_cutover: string
          city: string | null
          code: string
          created_at: string
          district: string | null
          geofence_radius_m: number
          id: string
          is_active: boolean
          latitude: number | null
          location_accuracy_m: number | null
          location_captured_at: string | null
          location_label: string
          longitude: number | null
          name: string
          phone: string | null
          pincode: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          arrival_deadline?: string
          business_day_cutover?: string
          city?: string | null
          code: string
          created_at?: string
          district?: string | null
          geofence_radius_m?: number
          id?: string
          is_active?: boolean
          latitude?: number | null
          location_accuracy_m?: number | null
          location_captured_at?: string | null
          location_label: string
          longitude?: number | null
          name: string
          phone?: string | null
          pincode?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          arrival_deadline?: string
          business_day_cutover?: string
          city?: string | null
          code?: string
          created_at?: string
          district?: string | null
          geofence_radius_m?: number
          id?: string
          is_active?: boolean
          latitude?: number | null
          location_accuracy_m?: number | null
          location_captured_at?: string | null
          location_label?: string
          longitude?: number | null
          name?: string
          phone?: string | null
          pincode?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role_title: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          role_title?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role_title?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          biller_profile_id: string
          business_date: string
          closed_at: string | null
          counter_device_id: string
          id: string
          opened_at: string
          outlet_id: string
        }
        Insert: {
          biller_profile_id: string
          business_date: string
          closed_at?: string | null
          counter_device_id: string
          id: string
          opened_at?: string
          outlet_id: string
        }
        Update: {
          biller_profile_id?: string
          business_date?: string
          closed_at?: string | null
          counter_device_id?: string
          id?: string
          opened_at?: string
          outlet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_biller_profile_id_fkey"
            columns: ["biller_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_counter_device_id_fkey"
            columns: ["counter_device_id"]
            isOneToOne: false
            referencedRelation: "counter_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_account_active: { Args: never; Returns: boolean }
      app_account_email_valid: { Args: { input: string }; Returns: boolean }
      app_business_date: {
        Args: { cutover: string; ts: string }
        Returns: string
      }
      app_device_ok: { Args: never; Returns: boolean }
      app_distance_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      app_has_role_at: {
        Args: {
          outlet: string
          required: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      app_is_owner: { Args: never; Returns: boolean }
      app_may_look_up_customer: { Args: never; Returns: boolean }
      app_may_manage_person: { Args: { person: string }; Returns: boolean }
      app_may_see_person: { Args: { person: string }; Returns: boolean }
      app_normalize_account_email: { Args: { input: string }; Returns: string }
      app_normalize_username: { Args: { input: string }; Returns: string }
      app_outlets_for: {
        Args: { required: Database["public"]["Enums"]["app_role"] }
        Returns: string[]
      }
      app_person_assigned_at: {
        Args: { outlet: string; person: string }
        Returns: boolean
      }
      app_profile_has: {
        Args: {
          outlet: string
          profile: string
          required: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      app_username_from_auth_alias: { Args: { input: string }; Returns: string }
      app_username_valid: { Args: { input: string }; Returns: boolean }
      attendance_approve_attempt: {
        Args: {
          p_attendance_id: string
          p_decision_id: string
          p_expected_attempt_id: string
          p_expected_version: number
          p_manager_accuracy_m: number
          p_manager_lat: number
          p_manager_lng: number
          p_reason: string
        }
        Returns: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approver_accuracy_m: number | null
          approver_distance_m: number | null
          approver_lat: number | null
          approver_lng: number | null
          arrival_deadline: string | null
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_entered_by: string | null
          check_in_entered_by_name: string | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          created_at: string
          current_attempt_id: string | null
          id: string
          latest_decision_id: string | null
          outcome_attempt_id: string | null
          outlet_id: string
          person_id: string
          retry_blocked: boolean
          state_version: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        SetofOptions: {
          from: "*"
          to: "attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_correct: {
        Args: {
          p_action: string
          p_attendance_id: string
          p_corrected_at?: string
          p_decision_id: string
          p_expected_version: number
          p_manager_accuracy_m?: number
          p_manager_lat?: number
          p_manager_lng?: number
          p_reason: string
        }
        Returns: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approver_accuracy_m: number | null
          approver_distance_m: number | null
          approver_lat: number | null
          approver_lng: number | null
          arrival_deadline: string | null
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_entered_by: string | null
          check_in_entered_by_name: string | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          created_at: string
          current_attempt_id: string | null
          id: string
          latest_decision_id: string | null
          outcome_attempt_id: string | null
          outlet_id: string
          person_id: string
          retry_blocked: boolean
          state_version: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        SetofOptions: {
          from: "*"
          to: "attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_deny_attempt: {
        Args: {
          p_attendance_id: string
          p_decision_id: string
          p_expected_attempt_id: string
          p_expected_version: number
          p_prevent_retry?: boolean
          p_reason: string
        }
        Returns: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approver_accuracy_m: number | null
          approver_distance_m: number | null
          approver_lat: number | null
          approver_lng: number | null
          arrival_deadline: string | null
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_entered_by: string | null
          check_in_entered_by_name: string | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          created_at: string
          current_attempt_id: string | null
          id: string
          latest_decision_id: string | null
          outcome_attempt_id: string | null
          outlet_id: string
          person_id: string
          retry_blocked: boolean
          state_version: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        SetofOptions: {
          from: "*"
          to: "attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_elsewhere: {
        Args: { p_business_date: string; p_outlets: string[] }
        Returns: string[]
      }
      attendance_record_manual: {
        Args: {
          p_attempt_id: string
          p_attempted_at: string
          p_business_date: string
          p_decision_id: string
          p_outlet_id: string
          p_person_id: string
        }
        Returns: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approver_accuracy_m: number | null
          approver_distance_m: number | null
          approver_lat: number | null
          approver_lng: number | null
          arrival_deadline: string | null
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_entered_by: string | null
          check_in_entered_by_name: string | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          created_at: string
          current_attempt_id: string | null
          id: string
          latest_decision_id: string | null
          outcome_attempt_id: string | null
          outlet_id: string
          person_id: string
          retry_blocked: boolean
          state_version: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        SetofOptions: {
          from: "*"
          to: "attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_request_fingerprint: {
        Args: { payload: Json }
        Returns: string
      }
      attendance_submit_attempt: {
        Args: {
          p_accuracy_m: number
          p_attempt_id: string
          p_attempted_at: string
          p_business_date: string
          p_expected_version?: number
          p_lat: number
          p_lng: number
          p_outlet_id: string
        }
        Returns: {
          approval_reason: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approver_accuracy_m: number | null
          approver_distance_m: number | null
          approver_lat: number | null
          approver_lng: number | null
          arrival_deadline: string | null
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_entered_by: string | null
          check_in_entered_by_name: string | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          created_at: string
          current_attempt_id: string | null
          id: string
          latest_decision_id: string | null
          outcome_attempt_id: string | null
          outlet_id: string
          person_id: string
          retry_blocked: boolean
          state_version: number
          status: Database["public"]["Enums"]["attendance_status"]
        }
        SetofOptions: {
          from: "*"
          to: "attendance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_business_day: {
        Args: {
          p_actual_closing_paise: number
          p_business_date: string
          p_notes?: string
          p_opening_cash_paise: number
          p_outlet_id: string
        }
        Returns: {
          actual_closing_paise: number
          business_date: string
          cash_expenses_paise: number
          cash_sales_paise: number
          cash_withdrawn_paise: number
          closed_at: string
          closed_by: string
          difference_paise: number
          expected_closing_paise: number
          id: string
          notes: string | null
          opening_cash_paise: number
          outlet_id: string
        }
        SetofOptions: {
          from: "*"
          to: "daily_cash_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      customer_create_or_get: {
        Args: { p_name?: string; p_phone: string }
        Returns: {
          id: string
          name: string
          phone: string
        }[]
      }
      customer_directory: {
        Args: never
        Returns: {
          created_at: string
          id: string
          last_used_at: string
          name: string
          phone: string
        }[]
      }
      customer_lookup_by_phone: {
        Args: { p_phone: string }
        Returns: {
          id: string
          name: string
          phone: string
        }[]
      }
      customer_lookup_exceeded: {
        Args: {
          p_caller: string
          p_global?: number
          p_per_caller?: number
          p_window?: string
        }
        Returns: boolean
      }
      end_assignment_with_invite: {
        Args: {
          p_assignment_id: string
          p_code_hash: string
          p_issued_by: string
          p_valid_for: string
        }
        Returns: {
          assignment_id: string
          invite_expires_at: string
          invite_id: string
          person_id: string
        }[]
      }
      grant_assignment_with_invite: {
        Args: {
          p_account_email: string
          p_code_hash: string
          p_issued_by: string
          p_outlet_id: string
          p_person_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_valid_for: string
        }
        Returns: {
          assignment_id: string
          invite_expires_at: string
          invite_id: string
        }[]
      }
      invite_attempts_exceeded: {
        Args: {
          p_global?: number
          p_ip_hash: string
          p_per_ip?: number
          p_window?: string
        }
        Returns: boolean
      }
      invite_failure_pressure: { Args: { p_window?: string }; Returns: number }
      issue_account_invite: {
        Args: {
          p_code_hash: string
          p_issued_by: string
          p_profile_id: string
          p_valid_for: string
        }
        Returns: string
      }
      normalize_indian_phone: { Args: { p_input: string }; Returns: string }
      outlet_reference_counts: {
        Args: { p_outlet: string }
        Returns: {
          row_count: number
          table_name: string
        }[]
      }
      preview_account_invite: {
        Args: { p_code_hash: string; p_ip_hash?: string }
        Returns: {
          status: string
          username: string
        }[]
      }
      provision_account_with_invite: {
        Args: {
          p_account_email: string
          p_code_hash: string
          p_full_name: string
          p_issued_by: string
          p_outlet_ids: string[]
          p_phone: string
          p_profile_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_role_title: string
          p_started_on: string
          p_valid_for: string
        }
        Returns: {
          invite_expires_at: string
          invite_id: string
          profile_id: string
        }[]
      }
      record_customer_lookup: {
        Args: { p_caller: string; p_window?: string }
        Returns: undefined
      }
      record_invite_failure: {
        Args: { p_ip_hash: string; p_window?: string }
        Returns: undefined
      }
      redeem_account_invite: {
        Args: { p_code_hash: string; p_ip_hash?: string; p_username: string }
        Returns: {
          status: string
          user_id: string
        }[]
      }
      resolve_email_sign_in: {
        Args: {
          p_email: string
          p_global?: number
          p_ip_hash: string
          p_per_email?: number
          p_per_ip?: number
          p_window?: string
        }
        Returns: string
      }
      set_super_admin_account_email: {
        Args: { p_email: string; p_profile_id: string }
        Returns: undefined
      }
      username_rollout_ready: { Args: never; Returns: boolean }
    }
    Enums: {
      alert_category:
        | "inventory"
        | "equipment"
        | "cash_mismatch"
        | "employee"
        | "supplier"
        | "other"
      alert_priority: "low" | "normal" | "high" | "urgent"
      alert_status: "open" | "acknowledged" | "resolved" | "closed"
      app_role: "super_admin" | "franchise_admin" | "biller" | "employee"
      attendance_decision_kind:
        | "approve"
        | "deny"
        | "correct_present"
        | "correct_absent"
        | "allow_retry"
        | "absent_allow_retry"
        | "manual_present"
        | "legacy_outcome"
        | "correct_time"
      attendance_status: "present" | "absent" | "half_day" | "leave"
      bill_status: "settled" | "void"
      check_in_source: "phone" | "counter_tablet" | "manual"
      expense_category:
        | "raw_materials"
        | "salaries"
        | "rent"
        | "electricity"
        | "packaging"
        | "maintenance"
        | "marketing"
        | "other"
      inventory_unit: "kg" | "litre" | "packet" | "piece"
      movement_type: "added" | "used" | "wasted" | "correction"
      payment_method: "cash" | "upi" | "card" | "swiggy" | "zomato" | "other"
      pricing_mode: "no_tax" | "gst_inclusive" | "gst_exclusive"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      alert_category: [
        "inventory",
        "equipment",
        "cash_mismatch",
        "employee",
        "supplier",
        "other",
      ],
      alert_priority: ["low", "normal", "high", "urgent"],
      alert_status: ["open", "acknowledged", "resolved", "closed"],
      app_role: ["super_admin", "franchise_admin", "biller", "employee"],
      attendance_decision_kind: [
        "approve",
        "deny",
        "correct_present",
        "correct_absent",
        "allow_retry",
        "absent_allow_retry",
        "manual_present",
        "legacy_outcome",
        "correct_time",
      ],
      attendance_status: ["present", "absent", "half_day", "leave"],
      bill_status: ["settled", "void"],
      check_in_source: ["phone", "counter_tablet", "manual"],
      expense_category: [
        "raw_materials",
        "salaries",
        "rent",
        "electricity",
        "packaging",
        "maintenance",
        "marketing",
        "other",
      ],
      inventory_unit: ["kg", "litre", "packet", "piece"],
      movement_type: ["added", "used", "wasted", "correction"],
      payment_method: ["cash", "upi", "card", "swiggy", "zomato", "other"],
      pricing_mode: ["no_tax", "gst_inclusive", "gst_exclusive"],
    },
  },
} as const

