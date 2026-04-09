/**
 * RoleGuard Component
 * Conditionally renders children based on user roles and permissions
 * Always hides unauthorized content instead of showing disabled UI
 */

'use client';

import { ReactNode } from 'react';
import { usePermissions, useHasRole, type UserRole } from '../../lib/rbac';

interface RoleGuardProps {
  children: ReactNode;
  /** Array of allowed roles */
  allowedRoles?: UserRole[];
  /** Required permission key */
  permission?: keyof ReturnType<typeof usePermissions>;
  /** Content to show when user doesn't have access (default: null) */
  fallback?: ReactNode;
}

/**
 * RoleGuard - Render children only if user has required role or permission
 * 
 * Usage:
 * ```tsx
 * <RoleGuard allowedRoles={['org_admin', 'super_admin']}>
 *   <DeleteButton />
 * </RoleGuard>
 * 
 * <RoleGuard permission="canDeleteLead">
 *   <DeleteButton />
 * </RoleGuard>
 * ```
 */
export function RoleGuard({ children, allowedRoles, permission, fallback = null }: RoleGuardProps) {
  const permissions = usePermissions();
  const hasRole = useHasRole(allowedRoles || []);

  // Check role-based access
  if (allowedRoles && allowedRoles.length > 0) {
    if (!hasRole) return <>{fallback}</>;
  }

  // Check permission-based access
  if (permission) {
    if (!permissions[permission]) return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * ProtectedContent - Alternate API with more explicit naming
 */
export const ProtectedContent = RoleGuard;
