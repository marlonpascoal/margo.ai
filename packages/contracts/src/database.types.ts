
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
                    "account_id": string | null,"asaas_event": string,"asaas_event_id": string,"created_at": string,"id": string,"payload": NonNullable<Json>,"processed_at": string | null,"received_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"asaas_event": string,"asaas_event_id": string,"created_at"?: string,"id"?: string,"payload": NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"asaas_event"?: string,"asaas_event_id"?: string,"created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"updated_at"?: string
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
                    "created_at": string,"folder_url": string | null,"id": string,"logo_path": string | null,"name": string,"price_per_store_cents": number | null,"primary_color": string | null,"show_powered_by": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"folder_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name": string,"price_per_store_cents"?: number | null,"primary_color"?: string | null,"show_powered_by"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"folder_url"?: string | null,"id"?: string,"logo_path"?: string | null,"name"?: string,"price_per_store_cents"?: number | null,"primary_color"?: string | null,"show_powered_by"?: boolean,"updated_at"?: string
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
                },"extension_token": {
                  Row: {
                    "account_id": string,"created_at": string,"id": string,"last_used_at": string | null,"person_id": string,"revoked_at": string | null,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"id"?: string,"last_used_at"?: string | null,"person_id": string,"revoked_at"?: string | null,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"id"?: string,"last_used_at"?: string | null,"person_id"?: string,"revoked_at"?: string | null,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "extension_token_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
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
                },"invite": {
                  Row: {
                    "accepted_at": string | null,"account_id": string,"channel": Database["public"]['Enums']["contact_channel"],"created_at": string,"destination": string,"expires_at": string,"id": string,"invited_by": string | null,"kitchen_ids": (string)[],"role": Database["public"]['Enums']["member_role"],"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"account_id": string,"channel": Database["public"]['Enums']["contact_channel"],"created_at"?: string,"destination": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"kitchen_ids"?: (string)[],"role": Database["public"]['Enums']["member_role"],"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"account_id"?: string,"channel"?: Database["public"]['Enums']["contact_channel"],"created_at"?: string,"destination"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"kitchen_ids"?: (string)[],"role"?: Database["public"]['Enums']["member_role"],"token_hash"?: string,"updated_at"?: string
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
                    "account_id": string | null,"body": string,"channel": Database["public"]['Enums']["notification_channel"],"created_at": string,"id": string,"notice_code": string,"person_id": string | null,"provider_id": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["notification_status"],"subject": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"body": string,"channel": Database["public"]['Enums']["notification_channel"],"created_at"?: string,"id"?: string,"notice_code": string,"person_id"?: string | null,"provider_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"subject"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"body"?: string,"channel"?: Database["public"]['Enums']["notification_channel"],"created_at"?: string,"id"?: string,"notice_code"?: string,"person_id"?: string | null,"provider_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["notification_status"],"subject"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "account"
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
                },"owner_authorization": {
                  Row: {
                    "account_id": string,"company_id": string,"created_at": string,"document_path": string | null,"id": string,"includes_ai": boolean,"includes_international": boolean,"scope": (string)[],"signed_at": string,"signed_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"company_id": string,"created_at"?: string,"document_path"?: string | null,"id"?: string,"includes_ai"?: boolean,"includes_international"?: boolean,"scope"?: (string)[],"signed_at": string,"signed_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"company_id"?: string,"created_at"?: string,"document_path"?: string | null,"id"?: string,"includes_ai"?: boolean,"includes_international"?: boolean,"scope"?: (string)[],"signed_at"?: string,"signed_by"?: string | null,"updated_at"?: string
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
                    "billing_unit": Database["public"]['Enums']["billing_unit"],"code": string,"created_at": string,"features": NonNullable<Json>,"id": string,"name": string,"price_cents": number | null,"trial_days": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_unit"?: Database["public"]['Enums']["billing_unit"],"code": string,"created_at"?: string,"features"?: NonNullable<Json>,"id"?: string,"name": string,"price_cents"?: number | null,"trial_days"?: number,"updated_at"?: string
                  }
                  Update: {
                    "billing_unit"?: Database["public"]['Enums']["billing_unit"],"code"?: string,"created_at"?: string,"features"?: NonNullable<Json>,"id"?: string,"name"?: string,"price_cents"?: number | null,"trial_days"?: number,"updated_at"?: string
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
                }
          }
          Views: {
            [_ in never]: never
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
"finish_job":
{ Args: { "p_entry"?: Json,"p_job_id": string,"p_status": Database["public"]['Enums']["job_status"] }; Returns: boolean
                           },
"requeue_stuck_jobs":
{ Args: { "p_now"?: string }; Returns: {
              "alert_id": string,"job_id": string,"outcome": string
            }[]
                           }
          }
          Enums: {
            "actor_kind": "person"|"staff"|"system","alert_severity": "urgente"|"medio"|"baixo","billing_unit": "kitchen"|"channel_store","channel": "ifood"|"food99"|"keeta"|"rappi","contact_channel": "email"|"whatsapp","flag_env": "sandbox"|"production","job_status": "queued"|"running"|"done"|"failed","member_role": "dono"|"financeiro"|"gerente","notification_channel": "email"|"whatsapp"|"whatsapp_manual","notification_status": "queued"|"sent"|"failed"|"held_quiet_hours","session_surface": "console"|"portal","staff_role": "fundador"|"operacao","store_source": "public"|"api"|"file"|"extension"|"manual","subscription_status": "trial"|"active"|"past_due"|"canceled"|"free"
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
            "actor_kind": ["person", "staff", "system"],"alert_severity": ["urgente", "medio", "baixo"],"billing_unit": ["kitchen", "channel_store"],"channel": ["ifood", "food99", "keeta", "rappi"],"contact_channel": ["email", "whatsapp"],"flag_env": ["sandbox", "production"],"job_status": ["queued", "running", "done", "failed"],"member_role": ["dono", "financeiro", "gerente"],"notification_channel": ["email", "whatsapp", "whatsapp_manual"],"notification_status": ["queued", "sent", "failed", "held_quiet_hours"],"session_surface": ["console", "portal"],"staff_role": ["fundador", "operacao"],"store_source": ["public", "api", "file", "extension", "manual"],"subscription_status": ["trial", "active", "past_due", "canceled", "free"]
          }
        }
} as const
