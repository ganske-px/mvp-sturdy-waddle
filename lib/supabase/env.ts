function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const supabaseEnv = {
  url: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  anonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
};
