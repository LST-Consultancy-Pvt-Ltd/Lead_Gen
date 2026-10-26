import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDate(date: string | Date, fmt = 'MMM d, yyyy') {
  return format(new Date(date), fmt);
}

export function getInitials(name: string | null | undefined) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const intentColors: Record<string, string> = {
  hot: 'red',
  warm: 'amber',
  cold: 'gray',
};

export const statusColors: Record<string, string> = {
  new: 'blue',
  contacted: 'purple',
  replied: 'green',
  meeting_booked: 'emerald',
  qualified: 'teal',
  disqualified: 'gray',
  closed_won: 'green',
  closed_lost: 'red',
};

export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    super_admin: 'Super Admin',
    org_admin: 'Admin',
    manager: 'Manager',
    sales_user: 'Sales',
  };
  return labels[role] || role;
}

export function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    super_admin: 'purple',
    org_admin: 'blue',
    manager: 'cyan',
    sales_user: 'emerald',
  };
  return colors[role] || 'gray';
}

/** Canonical lead type regardless of casing / legacy names ('Services', 'service', 'position' → 'service'). */
export function normalizeLeadType(value: string | null | undefined): 'service' | 'product' | '' {
  const v = (value || '').toLowerCase().trim();
  if (!v) return '';
  if (v.startsWith('product')) return 'product';
  if (['service', 'services', 'position', 'positions'].includes(v)) return 'service';
  return '';
}

/** "proposal_sent" / "new" → "Proposal Sent" / "New" (display only). */
export function formatLabel(value: string | null | undefined): string {
  return (value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** pluralize(1, 'opportunity', 'opportunities') → "1 opportunity" */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

/**
 * Users a person may assign leads to / filter by owner.
 * Admins: everyone. Managers: themselves + members of their own team (managerId = manager).
 * Disabled users (isActive === false) are always excluded.
 */
export function assignableUsers<T extends { id: string; role?: string; managerId?: string | null; isActive?: boolean }>(
  users: T[] | undefined | null,
  me: { id: string; role: string } | null | undefined,
): T[] {
  const list = (Array.isArray(users) ? users : []).filter((u) => u.isActive !== false);
  if (!me) return [];
  if (me.role === 'manager') return list.filter((u) => u.id === me.id || u.managerId === me.id);
  return list;
}
