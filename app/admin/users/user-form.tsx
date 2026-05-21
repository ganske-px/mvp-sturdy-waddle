'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Service } from '@/lib/auth/permissions';
import { generateStrongPassword, validateTempPassword } from '@/lib/validators/password';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';

export type UserFormMode = 'create' | 'edit';

export type UserFormValues = {
  email: string;
  display_name: string;
  role: 'admin' | 'operator';
  permissions: Service[];
  password?: string;
};

// Inlined here (instead of importing from `@/lib/auth/permissions`) because that
// module is `server-only`; client components can only safely consume its types.
const ALL_SERVICES: readonly Service[] = ['search_person', 'search_company', 'search_bulk'] as const;

const SERVICE_LABEL: Record<Service, string> = {
  search_person: 'Buscar pessoa (CPF e nome)',
  search_company: 'Buscar empresa (CNPJ)',
  search_bulk: 'Buscar em lote',
};

export function UserForm({
  mode,
  initial,
  isLastActiveAdmin = false,
  onSubmit,
}: {
  mode: UserFormMode;
  initial: UserFormValues;
  isLastActiveAdmin?: boolean;
  onSubmit: (values: UserFormValues) => Promise<{ ok: false; error: string } | void>;
}) {
  const [values, setValues] = useState<UserFormValues>(initial);
  const [error, setError] = useState<string | null>(null);

  function togglePermission(svc: Service) {
    setValues((v) => ({
      ...v,
      permissions: v.permissions.includes(svc)
        ? v.permissions.filter((s) => s !== svc)
        : [...v.permissions, svc],
    }));
  }

  async function handleSubmit(_formData: FormData) {
    setError(null);
    if (mode === 'create') {
      const pwCheck = validateTempPassword(values.password ?? '');
      if (!pwCheck.ok) {
        setError(pwCheck.error);
        return;
      }
    }
    const result = await onSubmit(values);
    if (result && !result.ok) setError(result.error);
  }

  return (
    <form action={handleSubmit} className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          E-mail
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          value={values.email}
          disabled={mode === 'edit'}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="display_name" className="text-sm font-medium">
          Nome de exibição
        </label>
        <Input
          id="display_name"
          name="display_name"
          value={values.display_name}
          onChange={(e) => setValues((v) => ({ ...v, display_name: e.target.value }))}
        />
      </div>

      {mode === 'create' && (
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            Senha temporária
          </label>
          <div className="flex gap-2">
            <Input
              id="password"
              name="password"
              required
              minLength={12}
              value={values.password ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setValues((v) => ({ ...v, password: generateStrongPassword() }))}
            >
              Gerar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Mínimo 12 caracteres. Repasse pelo canal seguro; será exibida apenas uma vez.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Papel</label>
        <div className="flex gap-4 text-sm">
          {(['operator', 'admin'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input
                type="radio"
                name="role"
                value={r}
                checked={values.role === r}
                disabled={
                  mode === 'edit' &&
                  isLastActiveAdmin &&
                  r === 'operator' &&
                  initial.role === 'admin'
                }
                onChange={() => setValues((v) => ({ ...v, role: r }))}
              />
              {r === 'admin' ? 'Admin' : 'Operador'}
            </label>
          ))}
        </div>
        {mode === 'edit' && isLastActiveAdmin && initial.role === 'admin' && (
          <p className="text-xs text-amber-600">
            Este é o único admin ativo — não pode ser rebaixado.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2" disabled={values.role === 'admin'}>
        <legend className="text-sm font-medium">Permissões de serviço</legend>
        {values.role === 'admin' && (
          <p className="text-xs text-muted-foreground">
            Admins têm todas as permissões automaticamente.
          </p>
        )}
        {ALL_SERVICES.map((svc) => (
          <label key={svc} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.permissions.includes(svc)}
              onChange={() => togglePermission(svc)}
            />
            {SERVICE_LABEL[svc]}
          </label>
        ))}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <SubmitButton mode={mode} />
    </form>
  );
}

function SubmitButton({ mode }: { mode: UserFormMode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Salvando…' : mode === 'create' ? 'Criar operador' : 'Salvar alterações'}
    </Button>
  );
}
