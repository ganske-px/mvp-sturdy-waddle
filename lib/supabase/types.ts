// Hand-rolled types for now. When the schema stabilizes, replace with the
// output of `supabase gen types typescript --local`.

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          role: 'admin' | 'operator';
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          role?: 'admin' | 'operator';
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          role?: 'admin' | 'operator';
          is_active?: boolean;
          created_at?: string;
        };
      };
      searches: {
        Row: {
          id: string;
          user_id: string;
          search_type: 'cpf' | 'cnpj' | 'name';
          document_hash: string;
          term_preview: string;
          result_count: number;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          search_type: 'cpf' | 'cnpj' | 'name';
          document_hash: string;
          term_preview: string;
          result_count?: number;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          search_type?: 'cpf' | 'cnpj' | 'name';
          document_hash?: string;
          term_preview?: string;
          result_count?: number;
          error_message?: string | null;
          created_at?: string;
        };
      };
      predictus_cache: {
        Row: {
          document_hash: string;
          search_type: 'cpf' | 'cnpj' | 'name';
          encrypted_payload: string;
          result_count: number;
          fetched_at: string;
          expires_at: string;
        };
        Insert: {
          document_hash: string;
          search_type: 'cpf' | 'cnpj' | 'name';
          encrypted_payload: string;
          result_count?: number;
          fetched_at?: string;
          expires_at?: string;
        };
        Update: {
          document_hash?: string;
          search_type?: 'cpf' | 'cnpj' | 'name';
          encrypted_payload?: string;
          result_count?: number;
          fetched_at?: string;
          expires_at?: string;
        };
      };
      predictus_token: {
        Row: {
          id: number;
          access_token: string;
          refreshed_at: string;
        };
        Insert: {
          id?: number;
          access_token: string;
          refreshed_at?: string;
        };
        Update: {
          id?: number;
          access_token?: string;
          refreshed_at?: string;
        };
      };
      bulk_jobs: {
        Row: {
          id: string;
          user_id: string;
          status: 'pending' | 'running' | 'completed' | 'failed';
          total_items: number;
          done_items: number;
          error_items: number;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: 'pending' | 'running' | 'completed' | 'failed';
          total_items: number;
          done_items?: number;
          error_items?: number;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          status?: 'pending' | 'running' | 'completed' | 'failed';
          total_items?: number;
          done_items?: number;
          error_items?: number;
          created_at?: string;
          started_at?: string | null;
          finished_at?: string | null;
          error_message?: string | null;
        };
      };
      bulk_job_items: {
        Row: {
          id: string;
          job_id: string;
          document_hash: string;
          document_encrypted: string;
          document_type: 'cpf' | 'cnpj';
          document_preview: string;
          status: 'pending' | 'processing' | 'found' | 'clean' | 'error';
          result_count: number;
          error_message: string | null;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          job_id: string;
          document_hash: string;
          document_encrypted: string;
          document_type: 'cpf' | 'cnpj';
          document_preview: string;
          status?: 'pending' | 'processing' | 'found' | 'clean' | 'error';
          result_count?: number;
          error_message?: string | null;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string;
          document_hash?: string;
          document_encrypted?: string;
          document_type?: 'cpf' | 'cnpj';
          document_preview?: string;
          status?: 'pending' | 'processing' | 'found' | 'clean' | 'error';
          result_count?: number;
          error_message?: string | null;
          processed_at?: string | null;
        };
      };
      user_service_permissions: {
        Row: {
          user_id: string;
          service: 'search_person' | 'search_company' | 'search_bulk' | 'search_network';
          granted_at: string;
          granted_by: string | null;
        };
        Insert: {
          user_id: string;
          service: 'search_person' | 'search_company' | 'search_bulk' | 'search_network';
          granted_at?: string;
          granted_by?: string | null;
        };
        Update: {
          user_id?: string;
          service?: 'search_person' | 'search_company' | 'search_bulk' | 'search_network';
          granted_at?: string;
          granted_by?: string | null;
        };
      };
      audit_log: {
        Row: {
          id: string;
          user_id: string | null;
          action:
            | 'login'
            | 'logout'
            | 'search_single'
            | 'search_bulk_item'
            | 'bulk_job_created'
            | 'export_csv'
            | 'admin_user_created'
            | 'admin_user_set_active'
            | 'admin_user_set_role'
            | 'admin_user_permission_changed'
            | 'view_network'
            | 'expand_network_node';
          search_type: 'cpf' | 'cnpj' | 'name' | null;
          document_hash: string | null;
          result_count: number | null;
          ip: string | null;
          user_agent: string | null;
          metadata: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action:
            | 'login'
            | 'logout'
            | 'search_single'
            | 'search_bulk_item'
            | 'bulk_job_created'
            | 'export_csv'
            | 'admin_user_created'
            | 'admin_user_set_active'
            | 'admin_user_set_role'
            | 'admin_user_permission_changed'
            | 'view_network'
            | 'expand_network_node';
          search_type?: 'cpf' | 'cnpj' | 'name' | null;
          document_hash?: string | null;
          result_count?: number | null;
          ip?: string | null;
          user_agent?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?:
            | 'login'
            | 'logout'
            | 'search_single'
            | 'search_bulk_item'
            | 'bulk_job_created'
            | 'export_csv'
            | 'admin_user_created'
            | 'admin_user_set_active'
            | 'admin_user_set_role'
            | 'admin_user_permission_changed'
            | 'view_network'
            | 'expand_network_node';
          search_type?: 'cpf' | 'cnpj' | 'name' | null;
          document_hash?: string | null;
          result_count?: number | null;
          ip?: string | null;
          user_agent?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string;
        };
      };
      graph_nodes: {
        Row: {
          node_hash: string;
          node_type: 'cpf' | 'cnpj' | 'lawyer';
          encrypted_label: string;
          masked_preview: string;
          first_seen_at: string;
          last_seen_at: string;
        };
        Insert: {
          node_hash: string;
          node_type: 'cpf' | 'cnpj' | 'lawyer';
          encrypted_label: string;
          masked_preview: string;
          first_seen_at?: string;
          last_seen_at?: string;
        };
        Update: {
          node_hash?: string;
          node_type?: 'cpf' | 'cnpj' | 'lawyer';
          encrypted_label?: string;
          masked_preview?: string;
          first_seen_at?: string;
          last_seen_at?: string;
        };
      };
      graph_edges: {
        Row: {
          id: string;
          source_hash: string;
          target_hash: string;
          kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
          evidence: Record<string, unknown>;
          first_seen_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          source_hash: string;
          target_hash: string;
          kind: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
          evidence?: Record<string, unknown>;
          first_seen_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          source_hash?: string;
          target_hash?: string;
          kind?: 'co_party' | 'client_lawyer' | 'lawyer_lawyer';
          evidence?: Record<string, unknown>;
          first_seen_at?: string;
          last_seen_at?: string;
        };
      };
    };
    Functions: {
      is_admin: {
        Args: { uid: string };
        Returns: boolean;
      };
      has_service_permission: {
        Args: { uid: string; svc: string };
        Returns: boolean;
      };
      encrypt_graph_label: {
        Args: { plaintext: string };
        Returns: string;
      };
      decrypt_graph_label: {
        Args: { ciphertext: string };
        Returns: string;
      };
      upsert_graph: {
        Args: { nodes_in: unknown; edges_in: unknown };
        Returns: undefined;
      };
    };
  };
};
