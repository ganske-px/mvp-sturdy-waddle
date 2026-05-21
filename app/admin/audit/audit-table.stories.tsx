import type { Meta, StoryObj } from '@storybook/nextjs';
import { AuditTable, type AuditRow } from './audit-table';

const sample: AuditRow[] = [
  {
    id: '1',
    user_id: 'u1',
    user_email: 'maria@example.com',
    action: 'search_single',
    search_type: 'cpf',
    document_hash: '0123456789abcdef0123456789abcdef0123456789abcdef',
    result_count: 3,
    ip: '10.0.0.1',
    metadata: null,
    created_at: '2026-05-20T10:30:00Z',
  },
  {
    id: '2',
    user_id: 'u1',
    user_email: 'maria@example.com',
    action: 'bulk_job_created',
    search_type: null,
    document_hash: null,
    result_count: null,
    ip: '10.0.0.1',
    metadata: { job_id: 'abc', total_items: 50 },
    created_at: '2026-05-20T10:15:00Z',
  },
  {
    id: '3',
    user_id: 'a1',
    user_email: 'admin@example.com',
    action: 'admin_user_permission_changed',
    search_type: null,
    document_hash: null,
    result_count: null,
    ip: '10.0.0.2',
    metadata: { target_user_id: 'u1', service: 'search_bulk', granted: true },
    created_at: '2026-05-20T09:00:00Z',
  },
];

const meta = {
  title: 'Admin/AuditTable',
  component: AuditTable,
} satisfies Meta<typeof AuditTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = { args: { rows: sample } };
export const Empty: Story = { args: { rows: [] } };
