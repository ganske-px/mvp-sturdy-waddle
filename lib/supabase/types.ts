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
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
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
        Insert: Omit<Database['public']['Tables']['searches']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['searches']['Insert']>;
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
        Insert: Database['public']['Tables']['predictus_cache']['Row'];
        Update: Partial<Database['public']['Tables']['predictus_cache']['Insert']>;
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
        Insert: Omit<
          Database['public']['Tables']['bulk_jobs']['Row'],
          'id' | 'created_at' | 'status' | 'done_items' | 'error_items'
        > & {
          id?: string;
          created_at?: string;
          status?: Database['public']['Tables']['bulk_jobs']['Row']['status'];
          done_items?: number;
          error_items?: number;
        };
        Update: Partial<Database['public']['Tables']['bulk_jobs']['Insert']>;
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
        Insert: Omit<
          Database['public']['Tables']['bulk_job_items']['Row'],
          'id' | 'status' | 'result_count' | 'processed_at'
        > & {
          id?: string;
          status?: Database['public']['Tables']['bulk_job_items']['Row']['status'];
          result_count?: number;
          processed_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['bulk_job_items']['Insert']>;
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
        Insert: Omit<Database['public']['Tables']['audit_log']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['audit_log']['Insert']>;
      };
    };
  };
};
