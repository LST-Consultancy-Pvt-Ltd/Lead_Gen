/**
 * Role-Based Access Control (RBAC) System  
 * Centralized permission management for the CRM application
 */

import { useAuthStore } from '../store/authStore';

// ── Role Types ─────────────────────────────────────────────────────────────
export type UserRole = 'super_admin' | 'org_admin' | 'manager' | 'sales_user';

// ── Permission Definitions ─────────────────────────────────────────────────
export interface Permissions {
  // Role identifiers
  isSuperAdmin: boolean;
  isOrgAdmin: boolean;
  isManager: boolean;
  isSalesUser: boolean;
  isAdmin: boolean; // super_admin OR org_admin

  // Lead permissions
  canCreateLead: boolean;
  canViewAllLeads: boolean;
  canEditAllLeads: boolean;
  canDeleteLead: boolean;
  canReassignLead: boolean;
  canEnrichLead: boolean;
  canUseAI: boolean;
  canLogActivity: boolean;
  
  // Data management
  canImportData: boolean;
  canExportData: boolean;
  canBulkDelete: boolean;
  
  // User management
  canManageUsers: boolean;
  canChangeUserRoles: boolean;
  canInviteUsers: boolean;
  canDeactivateUsers: boolean;
  
  // Analytics & Reporting
  canViewAnalytics: boolean;
  canViewTeamAnalytics: boolean;
  canViewOrgAnalytics: boolean;
  
  // Settings & Configuration
  canAccessSettings: boolean;
  canModifySettings: boolean;
  canManageIntegrations: boolean;
  canManageDropdowns: boolean;
  
  // Campaign & Outreach
  canCreateCampaigns: boolean;
  canManageCampaigns: boolean;
  canSendEmails: boolean;
  
  // Opportunities
  canCreateOpportunities: boolean;
  canViewAllOpportunities: boolean;
  canDeleteOpportunities: boolean;

  // Own-record scoping
  canEditOwnLeads: boolean;
}

/**
 * Permission Matrix: Defines what each role can do
 */
const PERMISSION_MATRIX: Record<UserRole, Omit<Permissions, 'isSuperAdmin' | 'isOrgAdmin' | 'isManager' | 'isSalesUser' | 'isAdmin'>> = {
  super_admin: {
    canCreateLead: true,
    canViewAllLeads: true,
    canEditAllLeads: true,
    canDeleteLead: true,
    canReassignLead: true,
    canEnrichLead: true,
    canUseAI: true,
    canLogActivity: true,
    canImportData: true,
    canExportData: true,
    canBulkDelete: true,
    canManageUsers: true,
    canChangeUserRoles: true,
    canInviteUsers: true,
    canDeactivateUsers: true,
    canViewAnalytics: true,
    canViewTeamAnalytics: true,
    canViewOrgAnalytics: true,
    canAccessSettings: true,
    canModifySettings: true,
    canManageIntegrations: true,
    canManageDropdowns: true,
    canCreateCampaigns: true,
    canManageCampaigns: true,
    canSendEmails: true,
    canCreateOpportunities: true,
    canViewAllOpportunities: true,
    canDeleteOpportunities: true,
    canEditOwnLeads: true,
  },
  org_admin: {
    canCreateLead: true,
    canViewAllLeads: true,
    canEditAllLeads: true,
    canDeleteLead: true,
    canReassignLead: true,
    canEnrichLead: true,
    canUseAI: true,
    canLogActivity: true,
    canImportData: true,
    canExportData: true,
    canBulkDelete: true,
    canManageUsers: true,
    canChangeUserRoles: true,
    canInviteUsers: true,
    canDeactivateUsers: true,
    canViewAnalytics: true,
    canViewTeamAnalytics: true,
    canViewOrgAnalytics: true,
    canAccessSettings: true,
    canModifySettings: true,
    canManageIntegrations: true,
    canManageDropdowns: true,
    canCreateCampaigns: true,
    canManageCampaigns: true,
    canSendEmails: true,
    canCreateOpportunities: true,
    canViewAllOpportunities: true,
    canDeleteOpportunities: true,
    canEditOwnLeads: true,
  },
  manager: {
    canCreateLead: true,
    canViewAllLeads: true,
    canEditAllLeads: true,
    canDeleteLead: false,
    canReassignLead: true,
    canEnrichLead: true,
    canUseAI: true,
    canLogActivity: true,
    canImportData: true,
    canExportData: true,
    canBulkDelete: false,
    canManageUsers: false,
    canChangeUserRoles: false,
    canInviteUsers: false,
    canDeactivateUsers: false,
    canViewAnalytics: true,
    canViewTeamAnalytics: true,
    canViewOrgAnalytics: false,
    canAccessSettings: false,
    canModifySettings: false,
    canManageIntegrations: false,
    canManageDropdowns: true,
    canCreateCampaigns: true,
    canManageCampaigns: true,
    canSendEmails: true,
    canCreateOpportunities: true,
    canViewAllOpportunities: true,
    canDeleteOpportunities: false,
    canEditOwnLeads: true,
  },
  sales_user: {
    canCreateLead: true,
    canViewAllLeads: false,
    canEditAllLeads: false,
    canDeleteLead: false,
    canReassignLead: false,
    canEnrichLead: false,
    canUseAI: false,
    canLogActivity: true,
    canImportData: false,
    canExportData: true,
    canBulkDelete: false,
    canManageUsers: false,
    canChangeUserRoles: false,
    canInviteUsers: false,
    canDeactivateUsers: false,
    canViewAnalytics: false,
    canViewTeamAnalytics: false,
    canViewOrgAnalytics: false,
    canAccessSettings: false,
    canModifySettings: false,
    canManageIntegrations: false,
    canManageDropdowns: true,
    canCreateCampaigns: false,
    canManageCampaigns: false,
    canSendEmails: true,
    canCreateOpportunities: true,
    canViewAllOpportunities: false,
    canDeleteOpportunities: false,
    canEditOwnLeads: true,
  },
};

/**
 * Get permissions object for a specific role
 */
export function getPermissionsForRole(role: string | undefined): Permissions {
  const normalizedRole = (role as UserRole) || 'sales_user';
  const basePermissions = PERMISSION_MATRIX[normalizedRole] || PERMISSION_MATRIX.sales_user;

  return {
    isSuperAdmin: normalizedRole === 'super_admin',
    isOrgAdmin: normalizedRole === 'org_admin',
    isManager: normalizedRole === 'manager',
    isSalesUser: normalizedRole === 'sales_user',
    isAdmin: normalizedRole === 'super_admin' || normalizedRole === 'org_admin',
    ...basePermissions,
  };
}

/**
 * Custom hook to access current user's permissions
 * @returns Permissions object with all role checks and permission flags
 */
export function usePermissions(): Permissions {
  const user = useAuthStore((state) => state.user);
  return getPermissionsForRole(user?.role);
}

/**
 * Check if user has specific permission
 */
export function useHasPermission(permission: keyof Omit<Permissions, 'isSuperAdmin' | 'isOrgAdmin' | 'isManager' | 'isSalesUser' | 'isAdmin'>): boolean {
  const permissions = usePermissions();
  return permissions[permission];
}

/**
 * Check if user has any of the specified roles
 */
export function useHasRole(allowedRoles: UserRole[]): boolean {
  const user = useAuthStore((state) => state.user);
  const userRole = (user?.role as UserRole) || 'sales_user';
  return allowedRoles.includes(userRole);
}

/**
 * Get user role
 */
export function useUserRole(): UserRole {
  const user = useAuthStore((state) => state.user);
  return (user?.role as UserRole) || 'sales_user';
}

/**
 * Navigation items configuration based on role
 */
export interface NavItem {
  href: string;
  label: string;
  icon: any;
  roles: UserRole[];
}

/**
 * Get display label for role
 */
export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    super_admin: 'Super Admin',
    org_admin: 'Admin',
    manager: 'Manager',
    sales_user: 'Sales',
  };
  return labels[role] || role;
}

/**
 * Get role badge color
 */
export function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    super_admin: 'purple',
    org_admin: 'blue',
    manager: 'cyan',
    sales_user: 'emerald',
  };
  return colors[role] || 'gray';
}
