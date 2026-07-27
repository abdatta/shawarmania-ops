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
      account_invites: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          expires_at: string
          id: string
          issued_at: string
          issued_by: string
          outlet_id: string | null
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
          outlet_id?: string | null
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
          outlet_id?: string | null
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
            foreignKeyName: "account_invites_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
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
      attendance: {
        Row: {
          business_date: string
          check_in_accuracy_m: number | null
          check_in_at: string | null
          check_in_distance_m: number | null
          check_in_lat: number | null
          check_in_lng: number | null
          check_in_source: Database["public"]["Enums"]["check_in_source"] | null
          check_out_accuracy_m: number | null
          check_out_at: string | null
          check_out_distance_m: number | null
          check_out_lat: number | null
          check_out_lng: number | null
          check_out_source:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          created_at: string
          employee_id: string
          id: string
          outlet_id: string
          override_at: string | null
          override_by: string | null
          override_by_name: string | null
          override_reason: string | null
          status: Database["public"]["Enums"]["attendance_status"]
        }
        Insert: {
          business_date: string
          check_in_accuracy_m?: number | null
          check_in_at?: string | null
          check_in_distance_m?: number | null
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_in_source?:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          check_out_accuracy_m?: number | null
          check_out_at?: string | null
          check_out_distance_m?: number | null
          check_out_lat?: number | null
          check_out_lng?: number | null
          check_out_source?:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          created_at?: string
          employee_id: string
          id?: string
          outlet_id: string
          override_at?: string | null
          override_by?: string | null
          override_by_name?: string | null
          override_reason?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
        }
        Update: {
          business_date?: string
          check_in_accuracy_m?: number | null
          check_in_at?: string | null
          check_in_distance_m?: number | null
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_in_source?:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          check_out_accuracy_m?: number | null
          check_out_at?: string | null
          check_out_distance_m?: number | null
          check_out_lat?: number | null
          check_out_lng?: number | null
          check_out_source?:
            | Database["public"]["Enums"]["check_in_source"]
            | null
          created_at?: string
          employee_id?: string
          id?: string
          outlet_id?: string
          override_at?: string | null
          override_by?: string | null
          override_by_name?: string | null
          override_reason?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_override_by_fkey"
            columns: ["override_by"]
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
      customers: {
        Row: {
          bill_count: number
          first_seen_at: string
          id: string
          last_seen_at: string
          name: string | null
          outlet_id: string
          phone: string | null
          total_spend_paise: number
        }
        Insert: {
          bill_count?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string | null
          outlet_id: string
          phone?: string | null
          total_spend_paise?: number
        }
        Update: {
          bill_count?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string | null
          outlet_id?: string
          phone?: string | null
          total_spend_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "customers_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
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
      employees: {
        Row: {
          address: string | null
          employee_code: string
          employment_status: Database["public"]["Enums"]["employment_status"]
          full_name: string
          id: string
          joined_on: string | null
          outlet_id: string
          phone: string | null
          profile_id: string | null
          role_title: string | null
          salary_paise: number
        }
        Insert: {
          address?: string | null
          employee_code: string
          employment_status?: Database["public"]["Enums"]["employment_status"]
          full_name: string
          id?: string
          joined_on?: string | null
          outlet_id: string
          phone?: string | null
          profile_id?: string | null
          role_title?: string | null
          salary_paise?: number
        }
        Update: {
          address?: string | null
          employee_code?: string
          employment_status?: Database["public"]["Enums"]["employment_status"]
          full_name?: string
          id?: string
          joined_on?: string | null
          outlet_id?: string
          phone?: string | null
          profile_id?: string | null
          role_title?: string | null
          salary_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          outlet_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          outlet_id?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          outlet_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
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
      app_business_date: {
        Args: { cutover: string; ts: string }
        Returns: string
      }
      app_device_ok: { Args: never; Returns: boolean }
      app_distance_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      app_employee_outlet: { Args: { emp: string }; Returns: string }
      app_outlet_id: { Args: never; Returns: string }
      app_profile_has: {
        Args: {
          outlet: string
          profile: string
          required: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
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
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
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
      preview_account_invite: {
        Args: { p_code_hash: string; p_ip_hash?: string }
        Returns: {
          email: string
          status: string
        }[]
      }
      record_invite_failure: {
        Args: { p_ip_hash: string; p_window?: string }
        Returns: undefined
      }
      redeem_account_invite: {
        Args: { p_code_hash: string; p_ip_hash?: string }
        Returns: {
          status: string
          user_id: string
        }[]
      }
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
      attendance_status: "present" | "absent" | "half_day" | "leave"
      bill_status: "settled" | "void"
      check_in_source: "phone" | "counter_tablet"
      employment_status: "active" | "inactive" | "terminated"
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
      attendance_status: ["present", "absent", "half_day", "leave"],
      bill_status: ["settled", "void"],
      check_in_source: ["phone", "counter_tablet"],
      employment_status: ["active", "inactive", "terminated"],
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

