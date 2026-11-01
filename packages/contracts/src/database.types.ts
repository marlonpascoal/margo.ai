
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "account": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"is_synthetic": boolean,"name": string,"plan_id": string | null,"trial_ends_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"name": string,"plan_id"?: string | null,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"name"?: string,"plan_id"?: string | null,"trial_ends_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plan"
      referencedColumns: ["id"]
    }
                  ]
                },"alert": {
                  Row: {
                    "account_id": string | null,"created_at": string,"id": string,"link": string | null,"notified_via": (string)[],"opened_at": string,"resolved_at": string | null,"resolved_by": string | null,"severity": Database["public"]['Enums']["alert_severity"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"created_at"?: string,"id"?: string,"link"?: string | null,"notified_via"?: (string)[],"opened_at"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null,"severity": Database["public"]['Enums']["alert_severity"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"created_at"?: string,"id"?: string,"link"?: string | null,"notified_via"?: (string)[],"opened_at"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null,"severity"?: Database["public"]['Enums']["alert_severity"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alert_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "alert_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "account_id": string | null,"action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_person_id": string | null,"after": Json | null,"at": string,"before": Json | null,"created_at": string,"entity": string,"entity_id": string | null,"id": string,"ip": unknown,"updated_at": string,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"action": string,"actor_kind": Database["public"]['Enums']["actor_kind"],"actor_person_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: string,"ip"?: unknown,"updated_at"?: string,"user_agent"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"action"?: string,"actor_kind"?: Database["public"]['Enums']["actor_kind"],"actor_person_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"ip"?: unknown,"updated_at"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"auth_code_guard": {
                  Row: {
                    "attempts": number,"created_at": string,"email": string,"id": string,"locked_until": string | null,"sent_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"email": string,"id"?: string,"locked_until"?: string | null,"sent_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"email"?: string,"id"?: string,"locked_until"?: string | null,"sent_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"billing_event": {
                  Row: {
                    "account_id": string | null,"asaas_event": string,"asaas_event_id": string,"created_at": string,"id": string,"kind": string | null,"payload": NonNullable<Json>,"processed_at": string | null,"received_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"asaas_event": string,"asaas_event_id": string,"created_at"?: string,"id"?: string,"kind"?: string | null,"payload": NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"asaas_event"?: string,"asaas_event_id"?: string,"created_at"?: string,"id"?: string,"kind"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_event_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"billing_invoice": {
                  Row: {
                    "account_id": string,"amount_cents": number,"asaas_payment_id": string,"asaas_subscription_id": string | null,"created_at": string,"due_on": string | null,"id": string,"status": Database["public"]['Enums']["invoice_status"],"units": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"asaas_payment_id": string,"asaas_subscription_id"?: string | null,"created_at"?: string,"due_on"?: string | null,"id"?: string,"status": Database["public"]['Enums']["invoice_status"],"units"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"asaas_payment_id"?: string,"asaas_subscription_id"?: string | null,"created_at"?: string,"due_on"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["invoice_status"],"units"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_invoice_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"bpo_client": {
                  Row: {
                    "account_id": string,"bpo_partner_id": string,"created_at": string,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"bpo_partner_id": string,"created_at"?: string,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"bpo_partner_id"?: string,"created_at"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bpo_client_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bpo_client_bpo_partner_id_fkey"
      columns: ["bpo_partner_id"]
isOneToOne: false
      referencedRelation: "bpo_partner"
      referencedColumns: ["id"]
    }
                  ]
                },"bpo_partner": {
                  Row: {
                    "created_at": string,"folder_url": string | null,"id": string,"logo_path": string | null,"name": string,"pipeline_note": string | null,"price_per_store_cents": number | null,"primary_color": string | null,"show_powered_by": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"folder_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name": string,"pipeline_note"?: string | null,"price_per_store_cents"?: number | null,"primary_color"?: string | null,"show_powered_by"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"folder_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name"?: string,"pipeline_note"?: string | null,"price_per_store_cents"?: number | null,"primary_color"?: string | null,"show_powered_by"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"brand": {
                  Row: {
                    "account_id": string,"created_at": string,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "brand_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign": {
                  Row: {
                    "account_id": string,"channel_share_pct": number,"channel_store_id": string,"created_at": string,"discount_pct": number,"ends_on": string,"id": string,"name": string,"starts_on": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"channel_share_pct": number,"channel_store_id": string,"created_at"?: string,"discount_pct": number,"ends_on": string,"id"?: string,"name": string,"starts_on": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"channel_share_pct"?: number,"channel_store_id"?: string,"created_at"?: string,"discount_pct"?: number,"ends_on"?: string,"id"?: string,"name"?: string,"starts_on"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_item": {
                  Row: {
                    "account_id": string,"campaign_id": string,"created_at": string,"menu_item_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"campaign_id": string,"created_at"?: string,"menu_item_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"campaign_id"?: string,"created_at"?: string,"menu_item_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_item_account_id_campaign_id_fkey"
      columns: ["account_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaign"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "campaign_item_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_item_account_id_menu_item_id_fkey"
      columns: ["account_id","menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"channel_store": {
                  Row: {
                    "account_id": string,"authorized": boolean,"authorized_at": string | null,"brand_id": string | null,"channel": Database["public"]['Enums']["channel"],"corporate_name": string | null,"created_at": string,"external_id": string,"id": string,"kitchen_id": string | null,"listed": boolean,"name": string,"public_url": string | null,"source": Database["public"]['Enums']["store_source"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"authorized"?: boolean,"authorized_at"?: string | null,"brand_id"?: string | null,"channel": Database["public"]['Enums']["channel"],"corporate_name"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"kitchen_id"?: string | null,"listed"?: boolean,"name": string,"public_url"?: string | null,"source": Database["public"]['Enums']["store_source"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"authorized"?: boolean,"authorized_at"?: string | null,"brand_id"?: string | null,"channel"?: Database["public"]['Enums']["channel"],"corporate_name"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"kitchen_id"?: string | null,"listed"?: boolean,"name"?: string,"public_url"?: string | null,"source"?: Database["public"]['Enums']["store_source"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_store_account_id_brand_id_fkey"
      columns: ["account_id","brand_id"]
isOneToOne: false
      referencedRelation: "brand"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "channel_store_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_store_account_id_kitchen_id_fkey"
      columns: ["account_id","kitchen_id"]
isOneToOne: false
      referencedRelation: "kitchen"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"channel_store_url_history": {
                  Row: {
                    "channel_store_id": string,"created_at": string,"id": string,"seen_at": string,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_store_id": string,"created_at"?: string,"id"?: string,"seen_at"?: string,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "channel_store_id"?: string,"created_at"?: string,"id"?: string,"seen_at"?: string,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_store_url_history_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    }
                  ]
                },"close_cost_line": {
                  Row: {
                    "account_id": string,"channel_store_id": string,"close_period_id": string,"created_at": string,"id": string,"ingredient_cents": number,"packaging_cents": number,"uncovered_units": number,"units": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"channel_store_id": string,"close_period_id": string,"created_at"?: string,"id"?: string,"ingredient_cents"?: number,"packaging_cents"?: number,"uncovered_units"?: number,"units"?: number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"channel_store_id"?: string,"close_period_id"?: string,"created_at"?: string,"id"?: string,"ingredient_cents"?: number,"packaging_cents"?: number,"uncovered_units"?: number,"units"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "close_cost_line_account_id_close_period_id_fkey"
      columns: ["account_id","close_period_id"]
isOneToOne: false
      referencedRelation: "close_period"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "close_cost_line_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "close_cost_line_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    }
                  ]
                },"close_decision": {
                  Row: {
                    "account_id": string,"base_left_cents": number | null,"campaign_discount_pct": number | null,"campaign_name": string | null,"channel": Database["public"]['Enums']["channel"],"close_period_id": string,"created_at": string,"kind": Database["public"]['Enums']["decision_kind"],"left_cents": number,"menu_item_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"base_left_cents"?: number | null,"campaign_discount_pct"?: number | null,"campaign_name"?: string | null,"channel": Database["public"]['Enums']["channel"],"close_period_id": string,"created_at"?: string,"kind": Database["public"]['Enums']["decision_kind"],"left_cents": number,"menu_item_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"base_left_cents"?: number | null,"campaign_discount_pct"?: number | null,"campaign_name"?: string | null,"channel"?: Database["public"]['Enums']["channel"],"close_period_id"?: string,"created_at"?: string,"kind"?: Database["public"]['Enums']["decision_kind"],"left_cents"?: number,"menu_item_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "close_decision_account_id_close_period_id_fkey"
      columns: ["account_id","close_period_id"]
isOneToOne: false
      referencedRelation: "close_period"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "close_decision_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "close_decision_account_id_menu_item_id_fkey"
      columns: ["account_id","menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"close_line": {
                  Row: {
                    "account_id": string,"anticipation_cents": number,"channel_store_id": string,"close_period_id": string,"commission_cents": number,"created_at": string,"delivery_cents": number,"gross_cents": number,"id": string,"payment_cents": number,"payout_cents": number,"promotion_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"anticipation_cents": number,"channel_store_id": string,"close_period_id": string,"commission_cents": number,"created_at"?: string,"delivery_cents": number,"gross_cents": number,"id"?: string,"payment_cents": number,"payout_cents": number,"promotion_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"anticipation_cents"?: number,"channel_store_id"?: string,"close_period_id"?: string,"commission_cents"?: number,"created_at"?: string,"delivery_cents"?: number,"gross_cents"?: number,"id"?: string,"payment_cents"?: number,"payout_cents"?: number,"promotion_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "close_line_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "close_line_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "close_line_close_period_id_fkey"
      columns: ["close_period_id"]
isOneToOne: false
      referencedRelation: "close_period"
      referencedColumns: ["id"]
    }
                  ]
                },"close_period": {
                  Row: {
                    "account_id": string,"computed_at": string | null,"created_at": string,"id": string,"kitchen_id": string | null,"month": string,"pdf_path": string | null,"status": Database["public"]['Enums']["close_status"],"updated_at": string,"xlsx_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"computed_at"?: string | null,"created_at"?: string,"id"?: string,"kitchen_id"?: string | null,"month": string,"pdf_path"?: string | null,"status"?: Database["public"]['Enums']["close_status"],"updated_at"?: string,"xlsx_path"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"computed_at"?: string | null,"created_at"?: string,"id"?: string,"kitchen_id"?: string | null,"month"?: string,"pdf_path"?: string | null,"status"?: Database["public"]['Enums']["close_status"],"updated_at"?: string,"xlsx_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "close_period_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "close_period_account_id_kitchen_id_fkey"
      columns: ["account_id","kitchen_id"]
isOneToOne: false
      referencedRelation: "kitchen"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"collector_page_cache": {
                  Row: {
                    "body": string,"created_at": string,"expires_at": string,"fetched_at": string,"status": number,"updated_at": string,"url": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"expires_at": string,"fetched_at": string,"status": number,"updated_at"?: string,"url": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"expires_at"?: string,"fetched_at"?: string,"status"?: number,"updated_at"?: string,"url"?: string
                  }
                  Relationships: [
                    
                  ]
                },"column_mapping": {
                  Row: {
                    "channel": Database["public"]['Enums']["channel"],"created_at": string,"created_by": string | null,"file_signature": string,"id": string,"mapping": NonNullable<Json>,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": Database["public"]['Enums']["channel"],"created_at"?: string,"created_by"?: string | null,"file_signature": string,"id"?: string,"mapping": NonNullable<Json>,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["channel"],"created_at"?: string,"created_by"?: string | null,"file_signature"?: string,"id"?: string,"mapping"?: NonNullable<Json>,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "column_mapping_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"company": {
                  Row: {
                    "account_id": string,"cnpj": string,"created_at": string,"id": string,"legal_name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"cnpj": string,"created_at"?: string,"id"?: string,"legal_name": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"cnpj"?: string,"created_at"?: string,"id"?: string,"legal_name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"contestation": {
                  Row: {
                    "account_id": string,"claim_text": string | null,"closed_at": string | null,"created_at": string,"credited_entry_id": string | null,"deadline_on": string | null,"difference_id": string,"id": string,"marked_at": string | null,"marked_by": string | null,"marked_by_kind": Database["public"]['Enums']["actor_kind"] | null,"protocol": string | null,"status": Database["public"]['Enums']["contestation_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"claim_text"?: string | null,"closed_at"?: string | null,"created_at"?: string,"credited_entry_id"?: string | null,"deadline_on"?: string | null,"difference_id": string,"id"?: string,"marked_at"?: string | null,"marked_by"?: string | null,"marked_by_kind"?: Database["public"]['Enums']["actor_kind"] | null,"protocol"?: string | null,"status": Database["public"]['Enums']["contestation_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"claim_text"?: string | null,"closed_at"?: string | null,"created_at"?: string,"credited_entry_id"?: string | null,"deadline_on"?: string | null,"difference_id"?: string,"id"?: string,"marked_at"?: string | null,"marked_by"?: string | null,"marked_by_kind"?: Database["public"]['Enums']["actor_kind"] | null,"protocol"?: string | null,"status"?: Database["public"]['Enums']["contestation_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contestation_account_id_difference_id_fkey"
      columns: ["account_id","difference_id"]
isOneToOne: false
      referencedRelation: "difference"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "contestation_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contestation_credited_entry_id_fkey"
      columns: ["credited_entry_id"]
isOneToOne: false
      referencedRelation: "ledger_entry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contestation_marked_by_fkey"
      columns: ["marked_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"contract_terms": {
                  Row: {
                    "account_id": string,"channel_store_id": string,"commission_pct": number,"created_at": string,"delivery_model": Database["public"]['Enums']["delivery_model"],"id": string,"payment_fee_pct": number,"plan_name": string,"updated_at": string,"valid_from": string,"valid_to": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"channel_store_id": string,"commission_pct": number,"created_at"?: string,"delivery_model": Database["public"]['Enums']["delivery_model"],"id"?: string,"payment_fee_pct": number,"plan_name": string,"updated_at"?: string,"valid_from": string,"valid_to"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"channel_store_id"?: string,"commission_pct"?: number,"created_at"?: string,"delivery_model"?: Database["public"]['Enums']["delivery_model"],"id"?: string,"payment_fee_pct"?: number,"plan_name"?: string,"updated_at"?: string,"valid_from"?: string,"valid_to"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_terms_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contract_terms_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    }
                  ]
                },"contribution": {
                  Row: {
                    "account_id": string,"campaign_discount_pct": number | null,"campaign_name": string | null,"can_invert": boolean,"channel": Database["public"]['Enums']["channel"],"channel_take_cents": number,"close_period_id": string,"created_at": string,"id": string,"ingredient_cents": number,"ingredient_error_pct": number,"left_cents": number,"left_pct": number | null,"menu_item_id": string,"packaging_cents": number,"price_cents": number,"prices_as_of": string | null,"units": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"campaign_discount_pct"?: number | null,"campaign_name"?: string | null,"can_invert"?: boolean,"channel": Database["public"]['Enums']["channel"],"channel_take_cents": number,"close_period_id": string,"created_at"?: string,"id"?: string,"ingredient_cents": number,"ingredient_error_pct": number,"left_cents": number,"left_pct"?: number | null,"menu_item_id": string,"packaging_cents"?: number,"price_cents": number,"prices_as_of"?: string | null,"units"?: number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"campaign_discount_pct"?: number | null,"campaign_name"?: string | null,"can_invert"?: boolean,"channel"?: Database["public"]['Enums']["channel"],"channel_take_cents"?: number,"close_period_id"?: string,"created_at"?: string,"id"?: string,"ingredient_cents"?: number,"ingredient_error_pct"?: number,"left_cents"?: number,"left_pct"?: number | null,"menu_item_id"?: string,"packaging_cents"?: number,"price_cents"?: number,"prices_as_of"?: string | null,"units"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contribution_account_id_close_period_id_fkey"
      columns: ["account_id","close_period_id"]
isOneToOne: false
      referencedRelation: "close_period"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "contribution_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contribution_account_id_menu_item_id_fkey"
      columns: ["account_id","menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"difference": {
                  Row: {
                    "account_id": string,"amount_cents": number,"channel_store_id": string,"close_period_id": string,"confidence": Database["public"]['Enums']["difference_confidence"],"created_at": string,"description": string,"detail": NonNullable<Json>,"evidence_path": string | null,"finding_key": string,"id": string,"orders_count": number,"rule_id": string,"shown": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"channel_store_id": string,"close_period_id": string,"confidence": Database["public"]['Enums']["difference_confidence"],"created_at"?: string,"description": string,"detail"?: NonNullable<Json>,"evidence_path"?: string | null,"finding_key": string,"id"?: string,"orders_count": number,"rule_id": string,"shown"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"channel_store_id"?: string,"close_period_id"?: string,"confidence"?: Database["public"]['Enums']["difference_confidence"],"created_at"?: string,"description"?: string,"detail"?: NonNullable<Json>,"evidence_path"?: string | null,"finding_key"?: string,"id"?: string,"orders_count"?: number,"rule_id"?: string,"shown"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "difference_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "difference_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "difference_close_period_id_fkey"
      columns: ["close_period_id"]
isOneToOne: false
      referencedRelation: "close_period"
      referencedColumns: ["id"]
    }
                  ]
                },"difference_order": {
                  Row: {
                    "account_id": string,"amount_cents": number,"created_at": string,"difference_id": string,"id": string,"order_fact_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"created_at"?: string,"difference_id": string,"id"?: string,"order_fact_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"created_at"?: string,"difference_id"?: string,"id"?: string,"order_fact_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "difference_order_account_id_difference_id_fkey"
      columns: ["account_id","difference_id"]
isOneToOne: false
      referencedRelation: "difference"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "difference_order_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "difference_order_order_fact_id_fkey"
      columns: ["order_fact_id"]
isOneToOne: false
      referencedRelation: "order_fact"
      referencedColumns: ["id"]
    }
                  ]
                },"extension_token": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"id": string,"last_used_at": string | null,"paired_at": string | null,"pairing_expires_at": string | null,"person_id": string,"revoked_at": string | null,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_used_at"?: string | null,"paired_at"?: string | null,"pairing_expires_at"?: string | null,"person_id": string,"revoked_at"?: string | null,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_used_at"?: string | null,"paired_at"?: string | null,"pairing_expires_at"?: string | null,"person_id"?: string,"revoked_at"?: string | null,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "extension_token_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extension_token_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "extension_token_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_flag": {
                  Row: {
                    "created_at": string,"default_lucro": boolean,"default_raio_x": boolean,"default_rede": boolean,"description": string,"env": Database["public"]['Enums']["flag_env"],"id": string,"key": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"default_lucro"?: boolean,"default_raio_x"?: boolean,"default_rede"?: boolean,"description": string,"env": Database["public"]['Enums']["flag_env"],"id"?: string,"key": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"default_lucro"?: boolean,"default_raio_x"?: boolean,"default_rede"?: boolean,"description"?: string,"env"?: Database["public"]['Enums']["flag_env"],"id"?: string,"key"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"feature_flag_log": {
                  Row: {
                    "account_id": string | null,"at": string,"by": string | null,"created_at": string,"env": Database["public"]['Enums']["flag_env"],"flag_key": string,"id": string,"new": boolean | null,"old": boolean | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"at"?: string,"by"?: string | null,"created_at"?: string,"env": Database["public"]['Enums']["flag_env"],"flag_key": string,"id"?: string,"new"?: boolean | null,"old"?: boolean | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"at"?: string,"by"?: string | null,"created_at"?: string,"env"?: Database["public"]['Enums']["flag_env"],"flag_key"?: string,"id"?: string,"new"?: boolean | null,"old"?: boolean | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_flag_log_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feature_flag_log_by_fkey"
      columns: ["by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_override": {
                  Row: {
                    "account_id": string,"created_at": string,"env": Database["public"]['Enums']["flag_env"],"flag_key": string,"id": string,"reason": string,"set_by": string | null,"updated_at": string,"value": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"env": Database["public"]['Enums']["flag_env"],"flag_key": string,"id"?: string,"reason": string,"set_by"?: string | null,"updated_at"?: string,"value": boolean
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"env"?: Database["public"]['Enums']["flag_env"],"flag_key"?: string,"id"?: string,"reason"?: string,"set_by"?: string | null,"updated_at"?: string,"value"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_override_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feature_override_flag_key_env_fkey"
      columns: ["flag_key","env"]
isOneToOne: false
      referencedRelation: "feature_flag"
      referencedColumns: ["key","env"]
    },{
      foreignKeyName: "feature_override_set_by_fkey"
      columns: ["set_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"import_run": {
                  Row: {
                    "account_id": string,"channel": Database["public"]['Enums']["channel"],"created_at": string,"created_by": string | null,"duration_ms": number | null,"file_name": string | null,"file_path": string | null,"file_sha256": string | null,"id": string,"job_id": string | null,"log": NonNullable<Json>,"mapping_id": string | null,"period_end": string | null,"period_start": string | null,"rows_duplicate": number | null,"rows_new": number | null,"rows_total": number | null,"source_id": string | null,"status": Database["public"]['Enums']["import_status"],"store_ids": (string)[],"trigger": Database["public"]['Enums']["import_trigger"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"channel": Database["public"]['Enums']["channel"],"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"file_name"?: string | null,"file_path"?: string | null,"file_sha256"?: string | null,"id"?: string,"job_id"?: string | null,"log"?: NonNullable<Json>,"mapping_id"?: string | null,"period_end"?: string | null,"period_start"?: string | null,"rows_duplicate"?: number | null,"rows_new"?: number | null,"rows_total"?: number | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["import_status"],"store_ids"?: (string)[],"trigger": Database["public"]['Enums']["import_trigger"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"channel"?: Database["public"]['Enums']["channel"],"created_at"?: string,"created_by"?: string | null,"duration_ms"?: number | null,"file_name"?: string | null,"file_path"?: string | null,"file_sha256"?: string | null,"id"?: string,"job_id"?: string | null,"log"?: NonNullable<Json>,"mapping_id"?: string | null,"period_end"?: string | null,"period_start"?: string | null,"rows_duplicate"?: number | null,"rows_new"?: number | null,"rows_total"?: number | null,"source_id"?: string | null,"status"?: Database["public"]['Enums']["import_status"],"store_ids"?: (string)[],"trigger"?: Database["public"]['Enums']["import_trigger"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_run_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_run_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_run_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "job"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_run_mapping_id_fkey"
      columns: ["mapping_id"]
isOneToOne: false
      referencedRelation: "column_mapping"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_run_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "import_source"
      referencedColumns: ["id"]
    }
                  ]
                },"import_source": {
                  Row: {
                    "account_id": string,"channel": Database["public"]['Enums']["channel"],"created_at": string,"id": string,"kind": Database["public"]['Enums']["import_kind"],"last_ok_at": string | null,"paused_at": string | null,"paused_reason": string | null,"schedule_cron": string | null,"stale_after_hours": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"channel": Database["public"]['Enums']["channel"],"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["import_kind"],"last_ok_at"?: string | null,"paused_at"?: string | null,"paused_reason"?: string | null,"schedule_cron"?: string | null,"stale_after_hours"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"channel"?: Database["public"]['Enums']["channel"],"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["import_kind"],"last_ok_at"?: string | null,"paused_at"?: string | null,"paused_reason"?: string | null,"schedule_cron"?: string | null,"stale_after_hours"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_source_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"ingredient": {
                  Row: {
                    "base_unit": Database["public"]['Enums']["base_unit"],"category": string,"created_at": string,"gtin": (string)[],"id": string,"name": string,"short_name": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_unit": Database["public"]['Enums']["base_unit"],"category": string,"created_at"?: string,"gtin"?: (string)[],"id"?: string,"name": string,"short_name"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "base_unit"?: Database["public"]['Enums']["base_unit"],"category"?: string,"created_at"?: string,"gtin"?: (string)[],"id"?: string,"name"?: string,"short_name"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ingredient_account_rule": {
                  Row: {
                    "account_id": string,"confirmations": number,"created_at": string,"created_by": string | null,"id": string,"ingredient_id": string,"keywords": (string)[],"ncm_prefix": string | null,"unit": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"confirmations"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"ingredient_id": string,"keywords": (string)[],"ncm_prefix"?: string | null,"unit"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"confirmations"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"ingredient_id"?: string,"keywords"?: (string)[],"ncm_prefix"?: string | null,"unit"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingredient_account_rule_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_account_rule_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_account_rule_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredient"
      referencedColumns: ["id"]
    }
                  ]
                },"ingredient_match": {
                  Row: {
                    "account_id": string,"confidence": number | null,"confirmed_by": string | null,"conversion_factor": number | null,"created_at": string,"id": string,"ingredient_id": string,"invoice_line_id": string,"learned_at": string | null,"method": Database["public"]['Enums']["match_method"],"rule_note": string | null,"status": Database["public"]['Enums']["match_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"confidence"?: number | null,"confirmed_by"?: string | null,"conversion_factor"?: number | null,"created_at"?: string,"id"?: string,"ingredient_id": string,"invoice_line_id": string,"learned_at"?: string | null,"method": Database["public"]['Enums']["match_method"],"rule_note"?: string | null,"status"?: Database["public"]['Enums']["match_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"confidence"?: number | null,"confirmed_by"?: string | null,"conversion_factor"?: number | null,"created_at"?: string,"id"?: string,"ingredient_id"?: string,"invoice_line_id"?: string,"learned_at"?: string | null,"method"?: Database["public"]['Enums']["match_method"],"rule_note"?: string | null,"status"?: Database["public"]['Enums']["match_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingredient_match_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_match_account_id_invoice_line_id_fkey"
      columns: ["account_id","invoice_line_id"]
isOneToOne: false
      referencedRelation: "invoice_line"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "ingredient_match_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_match_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredient"
      referencedColumns: ["id"]
    }
                  ]
                },"ingredient_price": {
                  Row: {
                    "account_id": string,"created_at": string,"id": string,"ingredient_id": string,"invoice_line_id": string | null,"observed_on": string,"price_per_base_unit_cents": number,"source": Database["public"]['Enums']["price_source"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"id"?: string,"ingredient_id": string,"invoice_line_id"?: string | null,"observed_on": string,"price_per_base_unit_cents": number,"source": Database["public"]['Enums']["price_source"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"id"?: string,"ingredient_id"?: string,"invoice_line_id"?: string | null,"observed_on"?: string,"price_per_base_unit_cents"?: number,"source"?: Database["public"]['Enums']["price_source"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingredient_price_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_price_account_id_invoice_line_id_fkey"
      columns: ["account_id","invoice_line_id"]
isOneToOne: false
      referencedRelation: "invoice_line"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "ingredient_price_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredient"
      referencedColumns: ["id"]
    }
                  ]
                },"ingredient_rule": {
                  Row: {
                    "auto_confirm": boolean,"created_at": string,"created_by": string | null,"disputed_at": string | null,"disputed_ingredient_id": string | null,"id": string,"ingredient_id": string,"keywords": (string)[],"ncm_prefix": string | null,"source": string,"unit": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_confirm"?: boolean,"created_at"?: string,"created_by"?: string | null,"disputed_at"?: string | null,"disputed_ingredient_id"?: string | null,"id"?: string,"ingredient_id": string,"keywords": (string)[],"ncm_prefix"?: string | null,"source": string,"unit"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "auto_confirm"?: boolean,"created_at"?: string,"created_by"?: string | null,"disputed_at"?: string | null,"disputed_ingredient_id"?: string | null,"id"?: string,"ingredient_id"?: string,"keywords"?: (string)[],"ncm_prefix"?: string | null,"source"?: string,"unit"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingredient_rule_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_rule_disputed_ingredient_id_fkey"
      columns: ["disputed_ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredient"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingredient_rule_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredient"
      referencedColumns: ["id"]
    }
                  ]
                },"invite": {
                  Row: {
                    "accepted_at": string | null,"account_id": string,"channel": Database["public"]['Enums']["contact_channel"],"created_at": string,"destination": string,"expires_at": string,"id": string,"invited_by": string | null,"kitchen_ids": (string)[],"name": string | null,"role": Database["public"]['Enums']["member_role"],"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"account_id": string,"channel": Database["public"]['Enums']["contact_channel"],"created_at"?: string,"destination": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"kitchen_ids"?: (string)[],"name"?: string | null,"role": Database["public"]['Enums']["member_role"],"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"account_id"?: string,"channel"?: Database["public"]['Enums']["contact_channel"],"created_at"?: string,"destination"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"kitchen_ids"?: (string)[],"name"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invite_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invite_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice": {
                  Row: {
                    "access_key": string,"account_id": string,"company_id": string,"created_at": string,"id": string,"invoice_import_id": string | null,"issued_at": string,"issuer_cnpj": string,"issuer_name": string | null,"model": number,"source": Database["public"]['Enums']["invoice_source"],"total_cents": number,"updated_at": string,"xml_path": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_key": string,"account_id": string,"company_id": string,"created_at"?: string,"id"?: string,"invoice_import_id"?: string | null,"issued_at": string,"issuer_cnpj": string,"issuer_name"?: string | null,"model": number,"source": Database["public"]['Enums']["invoice_source"],"total_cents": number,"updated_at"?: string,"xml_path"?: string | null
                  }
                  Update: {
                    "access_key"?: string,"account_id"?: string,"company_id"?: string,"created_at"?: string,"id"?: string,"invoice_import_id"?: string | null,"issued_at"?: string,"issuer_cnpj"?: string,"issuer_name"?: string | null,"model"?: number,"source"?: Database["public"]['Enums']["invoice_source"],"total_cents"?: number,"updated_at"?: string,"xml_path"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_account_id_company_id_fkey"
      columns: ["account_id","company_id"]
isOneToOne: false
      referencedRelation: "company"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "invoice_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_invoice_import_id_fkey"
      columns: ["invoice_import_id"]
isOneToOne: false
      referencedRelation: "invoice_import"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_import": {
                  Row: {
                    "account_id": string,"created_at": string,"created_by": string | null,"duplicates": number | null,"duration_ms": number | null,"file_name": string | null,"file_path": string,"files_total": number | null,"id": string,"invoices_new": number | null,"invoices_total": number | null,"job_id": string | null,"log": NonNullable<Json>,"months_count": number | null,"nfce_count": number | null,"nfe_count": number | null,"rejected": number | null,"status": Database["public"]['Enums']["import_status"],"suppliers_count": number | null,"trigger": Database["public"]['Enums']["import_trigger"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"created_by"?: string | null,"duplicates"?: number | null,"duration_ms"?: number | null,"file_name"?: string | null,"file_path": string,"files_total"?: number | null,"id"?: string,"invoices_new"?: number | null,"invoices_total"?: number | null,"job_id"?: string | null,"log"?: NonNullable<Json>,"months_count"?: number | null,"nfce_count"?: number | null,"nfe_count"?: number | null,"rejected"?: number | null,"status"?: Database["public"]['Enums']["import_status"],"suppliers_count"?: number | null,"trigger"?: Database["public"]['Enums']["import_trigger"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"created_by"?: string | null,"duplicates"?: number | null,"duration_ms"?: number | null,"file_name"?: string | null,"file_path"?: string,"files_total"?: number | null,"id"?: string,"invoices_new"?: number | null,"invoices_total"?: number | null,"job_id"?: string | null,"log"?: NonNullable<Json>,"months_count"?: number | null,"nfce_count"?: number | null,"nfe_count"?: number | null,"rejected"?: number | null,"status"?: Database["public"]['Enums']["import_status"],"suppliers_count"?: number | null,"trigger"?: Database["public"]['Enums']["import_trigger"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_import_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_import_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_import_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "job"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_line": {
                  Row: {
                    "account_id": string,"ai_asked_at": string | null,"created_at": string,"description": string,"gtin": string | null,"id": string,"invoice_id": string,"line_no": number,"ncm": string | null,"qty": number,"total_cents": number,"unit": string,"unit_price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"ai_asked_at"?: string | null,"created_at"?: string,"description": string,"gtin"?: string | null,"id"?: string,"invoice_id": string,"line_no": number,"ncm"?: string | null,"qty": number,"total_cents": number,"unit": string,"unit_price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"ai_asked_at"?: string | null,"created_at"?: string,"description"?: string,"gtin"?: string | null,"id"?: string,"invoice_id"?: string,"line_no"?: number,"ncm"?: string | null,"qty"?: number,"total_cents"?: number,"unit"?: string,"unit_price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_line_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_line_account_id_invoice_id_fkey"
      columns: ["account_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"job": {
                  Row: {
                    "account_id": string | null,"attempts": number,"claimed_at": string | null,"created_at": string,"dedupe_key": string | null,"finished_at": string | null,"id": string,"log": NonNullable<Json>,"payload": NonNullable<Json>,"status": Database["public"]['Enums']["job_status"],"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"finished_at"?: string | null,"id"?: string,"log"?: NonNullable<Json>,"payload"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["job_status"],"type": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"attempts"?: number,"claimed_at"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"finished_at"?: string | null,"id"?: string,"log"?: NonNullable<Json>,"payload"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["job_status"],"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"kitchen": {
                  Row: {
                    "account_id": string,"address": string | null,"city": string | null,"company_id": string,"created_at": string,"id": string,"in_analysis": boolean,"lat": number | null,"lng": number | null,"name": string,"uf": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"address"?: string | null,"city"?: string | null,"company_id": string,"created_at"?: string,"id"?: string,"in_analysis"?: boolean,"lat"?: number | null,"lng"?: number | null,"name": string,"uf"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"address"?: string | null,"city"?: string | null,"company_id"?: string,"created_at"?: string,"id"?: string,"in_analysis"?: boolean,"lat"?: number | null,"lng"?: number | null,"name"?: string,"uf"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "kitchen_account_id_company_id_fkey"
      columns: ["account_id","company_id"]
isOneToOne: false
      referencedRelation: "company"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "kitchen_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_entry": {
                  Row: {
                    "account_id": string,"amount_cents": number,"channel_store_id": string,"created_at": string,"entry_date": string,"expected_payment_date": string | null,"external_entry_id": string,"id": string,"import_run_id": string | null,"order_fact_id": string | null,"raw_type": string | null,"type": Database["public"]['Enums']["ledger_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"channel_store_id": string,"created_at"?: string,"entry_date": string,"expected_payment_date"?: string | null,"external_entry_id": string,"id"?: string,"import_run_id"?: string | null,"order_fact_id"?: string | null,"raw_type"?: string | null,"type": Database["public"]['Enums']["ledger_type"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"channel_store_id"?: string,"created_at"?: string,"entry_date"?: string,"expected_payment_date"?: string | null,"external_entry_id"?: string,"id"?: string,"import_run_id"?: string | null,"order_fact_id"?: string | null,"raw_type"?: string | null,"type"?: Database["public"]['Enums']["ledger_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_entry_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entry_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entry_import_run_id_fkey"
      columns: ["import_run_id"]
isOneToOne: false
      referencedRelation: "import_run"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_entry_order_fact_id_fkey"
      columns: ["order_fact_id"]
isOneToOne: false
      referencedRelation: "order_fact"
      referencedColumns: ["id"]
    }
                  ]
                },"membership": {
                  Row: {
                    "account_id": string,"all_kitchens": boolean,"created_at": string,"id": string,"person_id": string,"role": Database["public"]['Enums']["member_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"all_kitchens"?: boolean,"created_at"?: string,"id"?: string,"person_id": string,"role": Database["public"]['Enums']["member_role"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"all_kitchens"?: boolean,"created_at"?: string,"id"?: string,"person_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_kitchen": {
                  Row: {
                    "created_at": string,"id": string,"kitchen_id": string,"membership_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kitchen_id": string,"membership_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kitchen_id"?: string,"membership_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_kitchen_kitchen_id_fkey"
      columns: ["kitchen_id"]
isOneToOne: false
      referencedRelation: "kitchen"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "membership_kitchen_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "membership"
      referencedColumns: ["id"]
    }
                  ]
                },"menu_item": {
                  Row: {
                    "account_id": string,"brand_id": string,"channel_item_ids": NonNullable<Json>,"created_at": string,"id": string,"is_top20": boolean,"name": string,"top20_rank": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"brand_id": string,"channel_item_ids"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_top20"?: boolean,"name": string,"top20_rank"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"brand_id"?: string,"channel_item_ids"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_top20"?: boolean,"name"?: string,"top20_rank"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_item_account_id_brand_id_fkey"
      columns: ["account_id","brand_id"]
isOneToOne: false
      referencedRelation: "brand"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "menu_item_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"notice_pref": {
                  Row: {
                    "account_id": string,"created_at": string,"email": boolean,"id": string,"notice_code": string,"person_id": string,"updated_at": string,"whatsapp": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"email": boolean,"id"?: string,"notice_code": string,"person_id": string,"updated_at"?: string,"whatsapp": boolean
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"email"?: boolean,"id"?: string,"notice_code"?: string,"person_id"?: string,"updated_at"?: string,"whatsapp"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "notice_pref_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notice_pref_notice_code_fkey"
      columns: ["notice_code"]
isOneToOne: false
      referencedRelation: "notice_type"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "notice_pref_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"notice_type": {
                  Row: {
                    "audience_roles": (string)[],"code": string,"created_at": string,"default_email": boolean,"default_whatsapp": boolean,"email_locked": boolean,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience_roles": (string)[],"code": string,"created_at"?: string,"default_email": boolean,"default_whatsapp": boolean,"email_locked"?: boolean,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "audience_roles"?: (string)[],"code"?: string,"created_at"?: string,"default_email"?: boolean,"default_whatsapp"?: boolean,"email_locked"?: boolean,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notification": {
                  Row: {
                    "account_id": string | null,"alert_id": string | null,"attachment_path": string | null,"body": string,"channel": Database["public"]['Enums']["notification_channel"],"created_at": string,"html": string | null,"id": string,"manual_sent_at": string | null,"manual_sent_by": string | null,"notice_code": string | null,"person_id": string | null,"provider_id": string | null,"recipient": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"],"subject": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"alert_id"?: string | null,"attachment_path"?: string | null,"body": string,"channel": Database["public"]['Enums']["notification_channel"],"created_at"?: string,"html"?: string | null,"id"?: string,"manual_sent_at"?: string | null,"manual_sent_by"?: string | null,"notice_code"?: string | null,"person_id"?: string | null,"provider_id"?: string | null,"recipient"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"subject"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"alert_id"?: string | null,"attachment_path"?: string | null,"body"?: string,"channel"?: Database["public"]['Enums']["notification_channel"],"created_at"?: string,"html"?: string | null,"id"?: string,"manual_sent_at"?: string | null,"manual_sent_by"?: string | null,"notice_code"?: string | null,"person_id"?: string | null,"provider_id"?: string | null,"recipient"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"subject"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_alert_id_fkey"
      columns: ["alert_id"]
isOneToOne: false
      referencedRelation: "alert"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_manual_sent_by_fkey"
      columns: ["manual_sent_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_notice_code_fkey"
      columns: ["notice_code"]
isOneToOne: false
      referencedRelation: "notice_type"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "notification_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"order_fact": {
                  Row: {
                    "account_id": string,"cancel_reason": string | null,"cancelled_by": Database["public"]['Enums']["cancel_party"] | null,"channel_store_id": string,"created_at": string,"delivery_fee_cents": number,"discount_channel_cents": number,"discount_store_cents": number,"external_order_id": string,"gross_cents": number,"id": string,"import_run_id": string | null,"items_cents": number,"ordered_at": string,"status": Database["public"]['Enums']["order_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"cancel_reason"?: string | null,"cancelled_by"?: Database["public"]['Enums']["cancel_party"] | null,"channel_store_id": string,"created_at"?: string,"delivery_fee_cents"?: number,"discount_channel_cents"?: number,"discount_store_cents"?: number,"external_order_id": string,"gross_cents": number,"id"?: string,"import_run_id"?: string | null,"items_cents": number,"ordered_at": string,"status": Database["public"]['Enums']["order_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"cancel_reason"?: string | null,"cancelled_by"?: Database["public"]['Enums']["cancel_party"] | null,"channel_store_id"?: string,"created_at"?: string,"delivery_fee_cents"?: number,"discount_channel_cents"?: number,"discount_store_cents"?: number,"external_order_id"?: string,"gross_cents"?: number,"id"?: string,"import_run_id"?: string | null,"items_cents"?: number,"ordered_at"?: string,"status"?: Database["public"]['Enums']["order_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_fact_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_fact_channel_store_id_fkey"
      columns: ["channel_store_id"]
isOneToOne: false
      referencedRelation: "channel_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_fact_import_run_id_fkey"
      columns: ["import_run_id"]
isOneToOne: false
      referencedRelation: "import_run"
      referencedColumns: ["id"]
    }
                  ]
                },"order_item_fact": {
                  Row: {
                    "account_id": string,"created_at": string,"external_item_id": string | null,"id": string,"item_name": string,"line_no": number,"order_fact_id": string,"qty": number,"unit_price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"external_item_id"?: string | null,"id"?: string,"item_name": string,"line_no": number,"order_fact_id": string,"qty": number,"unit_price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"external_item_id"?: string | null,"id"?: string,"item_name"?: string,"line_no"?: number,"order_fact_id"?: string,"qty"?: number,"unit_price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_item_fact_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_item_fact_account_id_order_fact_id_fkey"
      columns: ["account_id","order_fact_id"]
isOneToOne: false
      referencedRelation: "order_fact"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"owner_authorization": {
                  Row: {
                    "account_id": string,"company_id": string,"created_at": string,"document_path": string | null,"id": string,"includes_ai": boolean,"includes_international": boolean,"scope": (string)[],"signed_at": string,"signed_by": string | null,"terms_version": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"company_id": string,"created_at"?: string,"document_path"?: string | null,"id"?: string,"includes_ai"?: boolean,"includes_international"?: boolean,"scope"?: (string)[],"signed_at": string,"signed_by"?: string | null,"terms_version"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"company_id"?: string,"created_at"?: string,"document_path"?: string | null,"id"?: string,"includes_ai"?: boolean,"includes_international"?: boolean,"scope"?: (string)[],"signed_at"?: string,"signed_by"?: string | null,"terms_version"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "owner_authorization_account_id_company_id_fkey"
      columns: ["account_id","company_id"]
isOneToOne: false
      referencedRelation: "company"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "owner_authorization_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "owner_authorization_signed_by_fkey"
      columns: ["signed_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"packaging_cost": {
                  Row: {
                    "account_id": string,"channel": Database["public"]['Enums']["channel"],"cost_cents": number,"created_at": string,"id": string,"menu_item_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"channel": Database["public"]['Enums']["channel"],"cost_cents": number,"created_at"?: string,"id"?: string,"menu_item_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"channel"?: Database["public"]['Enums']["channel"],"cost_cents"?: number,"created_at"?: string,"id"?: string,"menu_item_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "packaging_cost_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "packaging_cost_account_id_menu_item_id_fkey"
      columns: ["account_id","menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["account_id","id"]
    }
                  ]
                },"person": {
                  Row: {
                    "auth_user_id": string | null,"created_at": string,"email": string | null,"id": string,"name": string,"updated_at": string,"whatsapp_e164": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"name": string,"updated_at"?: string,"whatsapp_e164"?: string | null
                  }
                  Update: {
                    "auth_user_id"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string,"whatsapp_e164"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"pilot": {
                  Row: {
                    "account_id": string,"cap_cents": number | null,"created_at": string,"fixed_from_day_61_cents": number | null,"id": string,"pct_months_1_2": number | null,"started_on": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"cap_cents"?: number | null,"created_at"?: string,"fixed_from_day_61_cents"?: number | null,"id"?: string,"pct_months_1_2"?: number | null,"started_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"cap_cents"?: number | null,"created_at"?: string,"fixed_from_day_61_cents"?: number | null,"id"?: string,"pct_months_1_2"?: number | null,"started_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pilot_account_id_fkey"
      columns: ["account_id"]
isOneToOne: true
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"pilot_charge": {
                  Row: {
                    "asaas_payment_id": string | null,"charge_cents": number,"created_at": string,"credited_cents": number,"id": string,"month": string,"pilot_id": string,"status": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asaas_payment_id"?: string | null,"charge_cents"?: number,"created_at"?: string,"credited_cents"?: number,"id"?: string,"month": string,"pilot_id": string,"status"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "asaas_payment_id"?: string | null,"charge_cents"?: number,"created_at"?: string,"credited_cents"?: number,"id"?: string,"month"?: string,"pilot_id"?: string,"status"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pilot_charge_pilot_id_fkey"
      columns: ["pilot_id"]
isOneToOne: false
      referencedRelation: "pilot"
      referencedColumns: ["id"]
    }
                  ]
                },"plan": {
                  Row: {
                    "billing_unit": Database["public"]['Enums']["billing_unit"],"code": string,"created_at": string,"features": NonNullable<Json>,"id": string,"name": string,"price_cents": number | null,"price_is_example": boolean,"trial_days": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_unit"?: Database["public"]['Enums']["billing_unit"],"code": string,"created_at"?: string,"features"?: NonNullable<Json>,"id"?: string,"name": string,"price_cents"?: number | null,"price_is_example"?: boolean,"trial_days"?: number,"updated_at"?: string
                  }
                  Update: {
                    "billing_unit"?: Database["public"]['Enums']["billing_unit"],"code"?: string,"created_at"?: string,"features"?: NonNullable<Json>,"id"?: string,"name"?: string,"price_cents"?: number | null,"price_is_example"?: boolean,"trial_days"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"public_menu_item": {
                  Row: {
                    "collected_at": string,"created_at": string,"description": string | null,"external_item_id": string,"id": string,"name": string,"price_cents": number,"public_store_id": string,"unit": Database["public"]['Enums']["menu_unit"],"unit_qty": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "collected_at"?: string,"created_at"?: string,"description"?: string | null,"external_item_id": string,"id"?: string,"name": string,"price_cents": number,"public_store_id": string,"unit"?: Database["public"]['Enums']["menu_unit"],"unit_qty"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "collected_at"?: string,"created_at"?: string,"description"?: string | null,"external_item_id"?: string,"id"?: string,"name"?: string,"price_cents"?: number,"public_store_id"?: string,"unit"?: Database["public"]['Enums']["menu_unit"],"unit_qty"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "public_menu_item_public_store_id_fkey"
      columns: ["public_store_id"]
isOneToOne: false
      referencedRelation: "public_store"
      referencedColumns: ["id"]
    }
                  ]
                },"public_menu_item_snapshot": {
                  Row: {
                    "collected_at": string,"created_at": string,"id": string,"name": string,"price_cents": number,"public_menu_item_id": string,"public_store_id": string,"unit": Database["public"]['Enums']["menu_unit"],"unit_qty": number | null,"updated_at": string,"xray_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "collected_at": string,"created_at"?: string,"id"?: string,"name": string,"price_cents": number,"public_menu_item_id": string,"public_store_id": string,"unit": Database["public"]['Enums']["menu_unit"],"unit_qty"?: number | null,"updated_at"?: string,"xray_id": string
                  }
                  Update: {
                    "collected_at"?: string,"created_at"?: string,"id"?: string,"name"?: string,"price_cents"?: number,"public_menu_item_id"?: string,"public_store_id"?: string,"unit"?: Database["public"]['Enums']["menu_unit"],"unit_qty"?: number | null,"updated_at"?: string,"xray_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "public_menu_item_snapshot_public_menu_item_id_fkey"
      columns: ["public_menu_item_id"]
isOneToOne: false
      referencedRelation: "public_menu_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_menu_item_snapshot_public_store_id_fkey"
      columns: ["public_store_id"]
isOneToOne: false
      referencedRelation: "public_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_menu_item_snapshot_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                },"public_store": {
                  Row: {
                    "area": string | null,"category": string | null,"channel": Database["public"]['Enums']["channel"],"created_at": string,"external_id": string,"id": string,"is_national_chain": boolean,"last_seen_open_at": string | null,"lat": number | null,"lng": number | null,"name": string | null,"updated_at": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "area"?: string | null,"category"?: string | null,"channel": Database["public"]['Enums']["channel"],"created_at"?: string,"external_id": string,"id"?: string,"is_national_chain"?: boolean,"last_seen_open_at"?: string | null,"lat"?: number | null,"lng"?: number | null,"name"?: string | null,"updated_at"?: string,"url"?: string | null
                  }
                  Update: {
                    "area"?: string | null,"category"?: string | null,"channel"?: Database["public"]['Enums']["channel"],"created_at"?: string,"external_id"?: string,"id"?: string,"is_national_chain"?: boolean,"last_seen_open_at"?: string | null,"lat"?: number | null,"lng"?: number | null,"name"?: string | null,"updated_at"?: string,"url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"public_store_snapshot": {
                  Row: {
                    "area": string | null,"category": string | null,"collected_at": string,"created_at": string,"id": string,"is_national_chain": boolean,"last_seen_open_at": string | null,"name": string | null,"public_store_id": string,"updated_at": string,"xray_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area"?: string | null,"category"?: string | null,"collected_at": string,"created_at"?: string,"id"?: string,"is_national_chain": boolean,"last_seen_open_at"?: string | null,"name"?: string | null,"public_store_id": string,"updated_at"?: string,"xray_id": string
                  }
                  Update: {
                    "area"?: string | null,"category"?: string | null,"collected_at"?: string,"created_at"?: string,"id"?: string,"is_national_chain"?: boolean,"last_seen_open_at"?: string | null,"name"?: string | null,"public_store_id"?: string,"updated_at"?: string,"xray_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "public_store_snapshot_public_store_id_fkey"
      columns: ["public_store_id"]
isOneToOne: false
      referencedRelation: "public_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_store_snapshot_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                },"recipe": {
                  Row: {
                    "account_id": string,"built_by": string | null,"built_on": string | null,"cost_as_of": string | null,"cost_cents": number | null,"cost_computed_at": string | null,"created_at": string,"error_pct": number | null,"id": string,"menu_item_id": string,"status": Database["public"]['Enums']["recipe_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"built_by"?: string | null,"built_on"?: string | null,"cost_as_of"?: string | null,"cost_cents"?: number | null,"cost_computed_at"?: string | null,"created_at"?: string,"error_pct"?: number | null,"id"?: string,"menu_item_id": string,"status"?: Database["public"]['Enums']["recipe_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"built_by"?: string | null,"built_on"?: string | null,"cost_as_of"?: string | null,"cost_cents"?: number | null,"cost_computed_at"?: string | null,"created_at"?: string,"error_pct"?: number | null,"id"?: string,"menu_item_id"?: string,"status"?: Database["public"]['Enums']["recipe_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipe_account_id_menu_item_id_fkey"
      columns: ["account_id","menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "recipe_built_by_fkey"
      columns: ["built_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"recipe_line": {
                  Row: {
                    "account_id": string,"cost_cents": number | null,"created_at": string,"id": string,"ingredient_id": string,"price_observed_on": string | null,"price_per_base_unit_cents": number | null,"price_source": Database["public"]['Enums']["price_source"] | null,"qty_base_units": number,"recipe_id": string,"updated_at": string,"yield_confidence": Database["public"]['Enums']["yield_confidence"],"yield_pct": number
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"cost_cents"?: number | null,"created_at"?: string,"id"?: string,"ingredient_id": string,"price_observed_on"?: string | null,"price_per_base_unit_cents"?: number | null,"price_source"?: Database["public"]['Enums']["price_source"] | null,"qty_base_units": number,"recipe_id": string,"updated_at"?: string,"yield_confidence": Database["public"]['Enums']["yield_confidence"],"yield_pct": number
                  }
                  Update: {
                    "account_id"?: string,"cost_cents"?: number | null,"created_at"?: string,"id"?: string,"ingredient_id"?: string,"price_observed_on"?: string | null,"price_per_base_unit_cents"?: number | null,"price_source"?: Database["public"]['Enums']["price_source"] | null,"qty_base_units"?: number,"recipe_id"?: string,"updated_at"?: string,"yield_confidence"?: Database["public"]['Enums']["yield_confidence"],"yield_pct"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_line_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipe_line_account_id_recipe_id_fkey"
      columns: ["account_id","recipe_id"]
isOneToOne: false
      referencedRelation: "recipe"
      referencedColumns: ["account_id","id"]
    },{
      foreignKeyName: "recipe_line_ingredient_id_fkey"
      columns: ["ingredient_id"]
isOneToOne: false
      referencedRelation: "ingredient"
      referencedColumns: ["id"]
    }
                  ]
                },"rule_param": {
                  Row: {
                    "created_at": string,"description": string,"key": string,"updated_at": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description": string,"key": string,"updated_at"?: string,"value": number
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"key"?: string,"updated_at"?: string,"value"?: number
                  }
                  Relationships: [
                    
                  ]
                },"security_lock": {
                  Row: {
                    "account_id": string,"created_at": string,"id": string,"reason": string,"until": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"id"?: string,"reason": string,"until": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"id"?: string,"reason"?: string,"until"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "security_lock_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    }
                  ]
                },"session_device": {
                  Row: {
                    "auth_session_id": string | null,"created_at": string,"device_key_hash": string | null,"id": string,"ip_city": string | null,"last_seen_at": string,"person_id": string,"revoked_at": string | null,"surface": Database["public"]['Enums']["session_surface"],"updated_at": string,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_session_id"?: string | null,"created_at"?: string,"device_key_hash"?: string | null,"id"?: string,"ip_city"?: string | null,"last_seen_at"?: string,"person_id": string,"revoked_at"?: string | null,"surface"?: Database["public"]['Enums']["session_surface"],"updated_at"?: string,"user_agent"?: string | null
                  }
                  Update: {
                    "auth_session_id"?: string | null,"created_at"?: string,"device_key_hash"?: string | null,"id"?: string,"ip_city"?: string | null,"last_seen_at"?: string,"person_id"?: string,"revoked_at"?: string | null,"surface"?: Database["public"]['Enums']["session_surface"],"updated_at"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_device_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "created_at": string,"id": string,"invited_by": string | null,"person_id": string,"role": Database["public"]['Enums']["staff_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"invited_by"?: string | null,"person_id": string,"role": Database["public"]['Enums']["staff_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"invited_by"?: string | null,"person_id"?: string,"role"?: Database["public"]['Enums']["staff_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_person_id_fkey"
      columns: ["person_id"]
isOneToOne: true
      referencedRelation: "person"
      referencedColumns: ["id"]
    }
                  ]
                },"subscription": {
                  Row: {
                    "account_id": string,"asaas_customer_id": string | null,"asaas_subscription_id": string | null,"created_at": string,"id": string,"last_event": string | null,"last_event_at": string | null,"next_due_on": string | null,"plan_id": string,"status": Database["public"]['Enums']["subscription_status"],"units_billed": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"asaas_customer_id"?: string | null,"asaas_subscription_id"?: string | null,"created_at"?: string,"id"?: string,"last_event"?: string | null,"last_event_at"?: string | null,"next_due_on"?: string | null,"plan_id": string,"status": Database["public"]['Enums']["subscription_status"],"units_billed"?: number,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"asaas_customer_id"?: string | null,"asaas_subscription_id"?: string | null,"created_at"?: string,"id"?: string,"last_event"?: string | null,"last_event_at"?: string | null,"next_due_on"?: string | null,"plan_id"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"units_billed"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_account_id_fkey"
      columns: ["account_id"]
isOneToOne: true
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscription_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plan"
      referencedColumns: ["id"]
    }
                  ]
                },"time_log": {
                  Row: {
                    "account_id": string | null,"created_at": string,"id": string,"minutes": number,"person_id": string | null,"step": string,"updated_at": string,"xray_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"created_at"?: string,"id"?: string,"minutes": number,"person_id"?: string | null,"step": string,"updated_at"?: string,"xray_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"created_at"?: string,"id"?: string,"minutes"?: number,"person_id"?: string | null,"step"?: string,"updated_at"?: string,"xray_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_log_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_log_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_log_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                },"xray": {
                  Row: {
                    "account_id": string | null,"categories": (string)[],"collected_at": string | null,"created_at": string,"created_by": string | null,"delivered_at": string | null,"id": string,"pdf_path": string | null,"radius_km": number,"rules": NonNullable<Json>,"status": Database["public"]['Enums']["xray_status"],"target_kind": string,"target_store_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"categories"?: (string)[],"collected_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_at"?: string | null,"id"?: string,"pdf_path"?: string | null,"radius_km"?: number,"rules"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["xray_status"],"target_kind"?: string,"target_store_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"categories"?: (string)[],"collected_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_at"?: string | null,"id"?: string,"pdf_path"?: string | null,"radius_km"?: number,"rules"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["xray_status"],"target_kind"?: string,"target_store_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "xray_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_target_store_id_fkey"
      columns: ["target_store_id"]
isOneToOne: false
      referencedRelation: "public_store"
      referencedColumns: ["id"]
    }
                  ]
                },"xray_item": {
                  Row: {
                    "created_at": string,"gap_pct": number | null,"id": string,"loss_cents": number | null,"menu_item_id": string | null,"norm_price_cents": number,"norm_unit": string,"pair_note": string | null,"pair_status": Database["public"]['Enums']["pair_status"],"pareto_cum_share": number | null,"pareto_rank": number | null,"parity_cents": number | null,"public_menu_item_id": string,"reading": Database["public"]['Enums']["xray_reading"] | null,"reviewed_at": string | null,"reviewed_by": string | null,"skipped": boolean,"updated_at": string,"weekly_units": number | null,"xray_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"gap_pct"?: number | null,"id"?: string,"loss_cents"?: number | null,"menu_item_id"?: string | null,"norm_price_cents": number,"norm_unit": string,"pair_note"?: string | null,"pair_status": Database["public"]['Enums']["pair_status"],"pareto_cum_share"?: number | null,"pareto_rank"?: number | null,"parity_cents"?: number | null,"public_menu_item_id": string,"reading"?: Database["public"]['Enums']["xray_reading"] | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"skipped"?: boolean,"updated_at"?: string,"weekly_units"?: number | null,"xray_id": string
                  }
                  Update: {
                    "created_at"?: string,"gap_pct"?: number | null,"id"?: string,"loss_cents"?: number | null,"menu_item_id"?: string | null,"norm_price_cents"?: number,"norm_unit"?: string,"pair_note"?: string | null,"pair_status"?: Database["public"]['Enums']["pair_status"],"pareto_cum_share"?: number | null,"pareto_rank"?: number | null,"parity_cents"?: number | null,"public_menu_item_id"?: string,"reading"?: Database["public"]['Enums']["xray_reading"] | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"skipped"?: boolean,"updated_at"?: string,"weekly_units"?: number | null,"xray_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "xray_item_menu_item_id_fkey"
      columns: ["menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_item_public_menu_item_id_fkey"
      columns: ["public_menu_item_id"]
isOneToOne: false
      referencedRelation: "public_menu_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_item_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_item_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                },"xray_pair": {
                  Row: {
                    "accepted": boolean,"by": string | null,"created_at": string,"id": string,"public_menu_item_id": string,"similarity": number,"updated_at": string,"xray_item_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted": boolean,"by"?: string | null,"created_at"?: string,"id"?: string,"public_menu_item_id": string,"similarity": number,"updated_at"?: string,"xray_item_id": string
                  }
                  Update: {
                    "accepted"?: boolean,"by"?: string | null,"created_at"?: string,"id"?: string,"public_menu_item_id"?: string,"similarity"?: number,"updated_at"?: string,"xray_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "xray_pair_by_fkey"
      columns: ["by"]
isOneToOne: false
      referencedRelation: "person"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_pair_public_menu_item_id_fkey"
      columns: ["public_menu_item_id"]
isOneToOne: false
      referencedRelation: "public_menu_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_pair_xray_item_id_fkey"
      columns: ["xray_item_id"]
isOneToOne: false
      referencedRelation: "xray_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_pair_xray_item_id_fkey"
      columns: ["xray_item_id"]
isOneToOne: false
      referencedRelation: "xray_item_view"
      referencedColumns: ["id"]
    }
                  ]
                },"xray_store": {
                  Row: {
                    "created_at": string,"delivers_to_target": boolean | null,"distance_m": number,"exclusion_reason": string | null,"id": string,"included": boolean,"public_store_id": string,"updated_at": string,"xray_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delivers_to_target"?: boolean | null,"distance_m": number,"exclusion_reason"?: string | null,"id"?: string,"included": boolean,"public_store_id": string,"updated_at"?: string,"xray_id": string
                  }
                  Update: {
                    "created_at"?: string,"delivers_to_target"?: boolean | null,"distance_m"?: number,"exclusion_reason"?: string | null,"id"?: string,"included"?: boolean,"public_store_id"?: string,"updated_at"?: string,"xray_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "xray_store_public_store_id_fkey"
      columns: ["public_store_id"]
isOneToOne: false
      referencedRelation: "public_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_store_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                },"xray_store_rank": {
                  Row: {
                    "created_at": string,"id": string,"is_target": boolean,"items_compared": number,"price_index": number,"public_store_id": string,"rank": number,"stores_ranked": number,"updated_at": string,"xray_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_target": boolean,"items_compared": number,"price_index": number,"public_store_id": string,"rank": number,"stores_ranked": number,"updated_at"?: string,"xray_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_target"?: boolean,"items_compared"?: number,"price_index"?: number,"public_store_id"?: string,"rank"?: number,"stores_ranked"?: number,"updated_at"?: string,"xray_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "xray_store_rank_public_store_id_fkey"
      columns: ["public_store_id"]
isOneToOne: false
      referencedRelation: "public_store"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_store_rank_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "xray_item_view": {
                  Row: {
                    "accepted_pairs": number | null,"comparables": number | null,"example_cents": number | null,"example_name": string | null,"gap_pct": number | null,"id": string,"loss_cents": number | null,"name": string,"norm_price_cents": number,"norm_unit": string,"own_cents": number,"pair_note": string | null,"pair_status": Database["public"]['Enums']["pair_status"],"pareto_cum_share": number | null,"pareto_rank": number | null,"parity_cents": number | null,"public_menu_item_id": string,"reading": Database["public"]['Enums']["xray_reading"] | null,"reviewed_at": string | null,"skipped": boolean,"unit": Database["public"]['Enums']["menu_unit"],"unit_qty": number | null,"weekly_units": number | null,"xray_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "xray_item_public_menu_item_id_fkey"
      columns: ["public_menu_item_id"]
isOneToOne: false
      referencedRelation: "public_menu_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "xray_item_xray_id_fkey"
      columns: ["xray_id"]
isOneToOne: false
      referencedRelation: "xray"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "claim_job":
{ Args: { "p_job_id": string }; Returns: {
              "account_id": string | null,
"attempts": number,
"claimed_at": string | null,
"created_at": string,
"dedupe_key": string | null,
"finished_at": string | null,
"id": string,
"log": NonNullable<Json>,
"payload": NonNullable<Json>,
"status": Database["public"]['Enums']["job_status"],
"type": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "job"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_next_job":
{ Args: { "p_type": string }; Returns: {
              "account_id": string | null,
"attempts": number,
"claimed_at": string | null,
"created_at": string,
"dedupe_key": string | null,
"finished_at": string | null,
"id": string,
"log": NonNullable<Json>,
"payload": NonNullable<Json>,
"status": Database["public"]['Enums']["job_status"],
"type": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "job"
        isOneToOne: false
        isSetofReturn: true
      } },
"confirm_ingredient_match":
{ Args: { "p_conversion"?: number,"p_match": string,"p_person": string }; Returns: string
                           },
"contestation_mark":
{ Args: { "p_actor"?: string,"p_actor_kind": Database["public"]['Enums']["actor_kind"],"p_at"?: string,"p_contestation": string,"p_credited_entry"?: string,"p_event": string,"p_ip"?: unknown,"p_protocol"?: string,"p_user_agent"?: string }; Returns: {
              "account_id": string,
"claim_text": string | null,
"closed_at": string | null,
"created_at": string,
"credited_entry_id": string | null,
"deadline_on": string | null,
"difference_id": string,
"id": string,
"marked_at": string | null,
"marked_by": string | null,
"marked_by_kind": Database["public"]['Enums']["actor_kind"] | null,
"protocol": string | null,
"status": Database["public"]['Enums']["contestation_status"],
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "contestation"
        isOneToOne: true
        isSetofReturn: false
      } },
"finish_job":
{ Args: { "p_entry"?: Json,"p_job_id": string,"p_status": Database["public"]['Enums']["job_status"] }; Returns: boolean
                           },
"flag_enabled":
{ Args: { "p_account": string,"p_env": Database["public"]['Enums']["flag_env"],"p_key": string }; Returns: boolean
                           },
"flag_remove_override":
{ Args: { "p_account": string,"p_actor": string,"p_env": Database["public"]['Enums']["flag_env"],"p_ip"?: unknown,"p_key": string,"p_user_agent"?: string }; Returns: undefined
                           },
"flag_set_default":
{ Args: { "p_actor": string,"p_env": Database["public"]['Enums']["flag_env"],"p_ip"?: unknown,"p_key": string,"p_plan": string,"p_user_agent"?: string,"p_value": boolean }; Returns: undefined
                           },
"flag_set_override":
{ Args: { "p_account": string,"p_actor": string,"p_env": Database["public"]['Enums']["flag_env"],"p_ip"?: unknown,"p_key": string,"p_reason": string,"p_user_agent"?: string,"p_value": boolean }; Returns: undefined
                           },
"invite_create":
{ Args: { "p_account": string,"p_actor": string,"p_at"?: string,"p_channel": Database["public"]['Enums']["contact_channel"],"p_destination": string,"p_ip"?: unknown,"p_kitchens": (string)[],"p_name": string,"p_role": Database["public"]['Enums']["member_role"],"p_token_hash": string,"p_user_agent"?: string }; Returns: {
              "accepted_at": string | null,
"account_id": string,
"channel": Database["public"]['Enums']["contact_channel"],
"created_at": string,
"destination": string,
"expires_at": string,
"id": string,
"invited_by": string | null,
"kitchen_ids": (string)[],
"name": string | null,
"role": Database["public"]['Enums']["member_role"],
"token_hash": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "invite"
        isOneToOne: true
        isSetofReturn: false
      } },
"invite_resend":
{ Args: { "p_actor": string,"p_at"?: string,"p_invite": string,"p_ip"?: unknown,"p_token_hash": string,"p_user_agent"?: string }; Returns: {
              "accepted_at": string | null,
"account_id": string,
"channel": Database["public"]['Enums']["contact_channel"],
"created_at": string,
"destination": string,
"expires_at": string,
"id": string,
"invited_by": string | null,
"kitchen_ids": (string)[],
"name": string | null,
"role": Database["public"]['Enums']["member_role"],
"token_hash": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "invite"
        isOneToOne: true
        isSetofReturn: false
      } },
"membership_remove":
{ Args: { "p_actor": string,"p_at"?: string,"p_ip"?: unknown,"p_membership": string,"p_user_agent"?: string }; Returns: undefined
                           },
"membership_update":
{ Args: { "p_actor": string,"p_all_kitchens": boolean,"p_at"?: string,"p_ip"?: unknown,"p_kitchens"?: (string)[],"p_membership": string,"p_role": Database["public"]['Enums']["member_role"],"p_user_agent"?: string }; Returns: {
              "account_id": string,
"all_kitchens": boolean,
"created_at": string,
"id": string,
"person_id": string,
"role": Database["public"]['Enums']["member_role"],
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "membership"
        isOneToOne: true
        isSetofReturn: false
      } },
"people_lock_until":
{ Args: { "p_account": string,"p_at"?: string }; Returns: string
                           },
"portal_accept_invite":
{ Args: { "p_email": string,"p_ip": unknown,"p_name": string,"p_now"?: string,"p_token_hash": string,"p_user_agent": string }; Returns: {
              "account_id": string,"email": string,"person_id": string,"status": string
            }[]
                           },
"portal_sign_up":
{ Args: { "p_cnpj": string,"p_email": string,"p_ip": unknown,"p_name": string,"p_now"?: string,"p_restaurant": string,"p_user_agent": string,"p_whatsapp": string,"p_xray": string }; Returns: {
              "account_id": string,"created": boolean,"person_id": string
            }[]
                           },
"requeue_stuck_jobs":
{ Args: { "p_now"?: string }; Returns: {
              "alert_id": string,"job_id": string,"outcome": string
            }[]
                           },
"security_lock_contact_change":
{ Args: { "p_at"?: string,"p_channel": Database["public"]['Enums']["contact_channel"],"p_ip"?: unknown,"p_person": string,"p_user_agent"?: string }; Returns: {
              "account_id": string,
"created_at": string,
"id": string,
"reason": string,
"until": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "security_lock"
        isOneToOne: false
        isSetofReturn: true
      } },
"time_log_save":
{ Args: { "p_actor": string,"p_ip"?: unknown,"p_minutes": Json,"p_user_agent"?: string,"p_xray": string }; Returns: undefined
                           },
"xray_calculate":
{ Args: { "p_actor": string,"p_ip"?: unknown,"p_user_agent"?: string,"p_xray": string }; Returns: undefined
                           },
"xray_confirm_stores":
{ Args: { "p_actor": string,"p_ip"?: unknown,"p_user_agent"?: string,"p_xray": string }; Returns: undefined
                           },
"xray_create":
{ Args: { "p_actor": string,"p_categories": (string)[],"p_external_id": string,"p_ip"?: unknown,"p_radius_km": number,"p_rules": Json,"p_url": string,"p_user_agent"?: string }; Returns: string
                           },
"xray_item_review":
{ Args: { "p_accepted": (string)[],"p_actor": string,"p_ip"?: unknown,"p_item": string,"p_user_agent"?: string }; Returns: undefined
                           },
"xray_item_set_skipped":
{ Args: { "p_actor": string,"p_ip"?: unknown,"p_item": string,"p_skipped": boolean,"p_user_agent"?: string }; Returns: undefined
                           },
"xray_mark_delivered":
{ Args: { "p_actor": string,"p_ip"?: unknown,"p_message": string,"p_user_agent"?: string,"p_xray": string }; Returns: undefined
                           },
"xray_prepare_delivery":
{ Args: { "p_actor": string,"p_ip"?: unknown,"p_user_agent"?: string,"p_xray": string }; Returns: undefined
                           },
"xray_store_set_included":
{ Args: { "p_actor": string,"p_included": boolean,"p_ip"?: unknown,"p_user_agent"?: string,"p_xray_store": string }; Returns: undefined
                           }
          }
          Enums: {
            "actor_kind": "person"|"staff"|"system","alert_severity": "urgente"|"medio"|"baixo","base_unit": "g"|"ml"|"un","billing_unit": "kitchen"|"channel_store","cancel_party": "loja"|"cliente"|"canal","channel": "ifood"|"food99"|"keeta"|"rappi","close_status": "open"|"computed"|"delivered","contact_channel": "email"|"whatsapp","contestation_status": "a_contestar"|"precisa_resposta"|"contestada"|"creditada"|"negada"|"prazo_vencido","decision_kind": "campaign"|"lowest","delivery_model": "canal"|"loja","difference_confidence": "certa"|"provavel"|"duvidosa","flag_env": "sandbox"|"production","import_kind": "api"|"extension"|"upload"|"bpo_folder"|"whatsapp","import_status": "queued"|"running"|"ok"|"failed"|"needs_mapping","import_trigger": "schedule"|"extension"|"upload"|"rerun"|"manual","invoice_source": "xml_zip"|"key_typed"|"qr_url"|"whatsapp_photo","invoice_status": "pending"|"confirmed"|"overdue"|"refused"|"canceled","job_status": "queued"|"running"|"done"|"failed","ledger_type": "commission"|"payment_fee"|"delivery"|"promotion"|"subsidy"|"refund"|"cancellation"|"anticipation"|"adjustment"|"payout"|"other","match_method": "gtin"|"rule"|"ai"|"manual","match_status": "suggested"|"confirmed"|"rejected","member_role": "dono"|"financeiro"|"gerente","menu_unit": "un"|"g"|"ml"|"pack","notification_channel": "email"|"whatsapp"|"whatsapp_manual","notification_status": "queued"|"sent"|"failed"|"held_quiet_hours","order_status": "concluido"|"cancelado","pair_status": "auto"|"revisar"|"normalizado"|"manual","price_source": "invoice"|"regional_prior","recipe_status": "draft"|"ready","session_surface": "console"|"portal","staff_role": "fundador"|"operacao","store_source": "public"|"api"|"file"|"extension"|"manual","subscription_status": "trial"|"active"|"past_due"|"canceled"|"free","xray_reading": "pode_subir"|"na_media"|"nao_mexer","xray_status": "draft"|"collecting"|"pairing"|"ready"|"delivered","yield_confidence": "medido"|"declarado"|"estimado"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "actor_kind": ["person", "staff", "system"],"alert_severity": ["urgente", "medio", "baixo"],"base_unit": ["g", "ml", "un"],"billing_unit": ["kitchen", "channel_store"],"cancel_party": ["loja", "cliente", "canal"],"channel": ["ifood", "food99", "keeta", "rappi"],"close_status": ["open", "computed", "delivered"],"contact_channel": ["email", "whatsapp"],"contestation_status": ["a_contestar", "precisa_resposta", "contestada", "creditada", "negada", "prazo_vencido"],"decision_kind": ["campaign", "lowest"],"delivery_model": ["canal", "loja"],"difference_confidence": ["certa", "provavel", "duvidosa"],"flag_env": ["sandbox", "production"],"import_kind": ["api", "extension", "upload", "bpo_folder", "whatsapp"],"import_status": ["queued", "running", "ok", "failed", "needs_mapping"],"import_trigger": ["schedule", "extension", "upload", "rerun", "manual"],"invoice_source": ["xml_zip", "key_typed", "qr_url", "whatsapp_photo"],"invoice_status": ["pending", "confirmed", "overdue", "refused", "canceled"],"job_status": ["queued", "running", "done", "failed"],"ledger_type": ["commission", "payment_fee", "delivery", "promotion", "subsidy", "refund", "cancellation", "anticipation", "adjustment", "payout", "other"],"match_method": ["gtin", "rule", "ai", "manual"],"match_status": ["suggested", "confirmed", "rejected"],"member_role": ["dono", "financeiro", "gerente"],"menu_unit": ["un", "g", "ml", "pack"],"notification_channel": ["email", "whatsapp", "whatsapp_manual"],"notification_status": ["queued", "sent", "failed", "held_quiet_hours"],"order_status": ["concluido", "cancelado"],"pair_status": ["auto", "revisar", "normalizado", "manual"],"price_source": ["invoice", "regional_prior"],"recipe_status": ["draft", "ready"],"session_surface": ["console", "portal"],"staff_role": ["fundador", "operacao"],"store_source": ["public", "api", "file", "extension", "manual"],"subscription_status": ["trial", "active", "past_due", "canceled", "free"],"xray_reading": ["pode_subir", "na_media", "nao_mexer"],"xray_status": ["draft", "collecting", "pairing", "ready", "delivered"],"yield_confidence": ["medido", "declarado", "estimado"]
          }
        }
} as const
