import { redirect } from 'next/navigation';
import { createUser } from '../actions';
import { UserForm, type UserFormValues } from '../user-form';

export const metadata = { title: 'Novo operador — Admin · Radar PX' };

export default function NewUserPage() {
  async function handleSubmit(values: UserFormValues) {
    'use server';
    if (!values.password) return { ok: false as const, error: 'Senha obrigatória.' };
    const result = await createUser({
      email: values.email.trim(),
      display_name: values.display_name.trim(),
      password: values.password,
      role: values.role,
      permissions: values.role === 'admin' ? [] : values.permissions,
    });
    if (!result.ok) return result;
    redirect(`/admin/users/${result.data?.userId}?created=1`);
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-primary/80">
          Administração · Operadores
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Novo operador
        </h1>
        <p className="text-muted-foreground">
          Crie a conta e defina a senha temporária. Repasse pelo canal seguro.
        </p>
      </header>
      <UserForm
        mode="create"
        initial={{
          email: '',
          display_name: '',
          role: 'operator',
          permissions: [],
          password: '',
        }}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
