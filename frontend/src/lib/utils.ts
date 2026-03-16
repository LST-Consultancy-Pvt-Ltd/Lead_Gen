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

export function getInitials(name: string) {
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
