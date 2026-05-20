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
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
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
          document_type?: 'cpf' | 'cnpj';
          document_preview?: string;
          status?: 'pending' | 'processing' | 'found' | 'clean' | 'error';
          result_count?: number;
          error_message?: string | null;
          processed_at?: string | null;
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
            | 'export_csv';
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
            | 'export_csv';
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
            | 'export_csv';
          search_type?: 'cpf' | 'cnpj' | 'name' | null;
          document_hash?: string | null;
          result_count?: number | null;
          ip?: string | null;
          user_agent?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string;
        };
      };
    };
  };
};
