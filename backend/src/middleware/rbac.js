/**
 * rbac.js
 * Role-Based Access Control Middleware
 */

const { error } = require('../utils/response');

/**
 * Check if user has any of the required roles
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    if (!roles.includes(req.user.role)) {
      return error(res, 'Insufficient permissions', 403);
    }

    next();
  };
};

/**
 * Check if user is manager or admin
 */
const requireManagerOrAdmin = requireRole('manager', 'org_admin', 'super_admin');

/**
 * Check if user is admin
 */
const requireAdmin = requireRole('org_admin', 'super_admin');

/**
 * Check if user is super admin
 */
const requireSuperAdmin = requireRole('super_admin');

/**
 * Permission helper to check if user can perform specific action
 */
const can = {
  viewAllLeads: (user) => ['manager', 'org_admin', 'super_admin'].includes(user.role),
  
  viewLead: (user, lead) => {
    if (['manager', 'org_admin', 'super_admin'].includes(user.role)) return true;
    return lead.assignedToId === user.id;
  },
  
  createLead: (user) => true, // All authenticated users can create leads
  
  updateLead: (user, lead) => {
    if (['manager', 'org_admin', 'super_admin'].includes(user.role)) return true;
    return lead.assignedToId === user.id;
  },
  
  deleteLead: (user) => ['org_admin', 'super_admin'].includes(user.role),
  
  assignLead: (user) => ['manager', 'org_admin', 'super_admin'].includes(user.role),
  
  viewAllActivities: (user) => ['manager', 'org_admin', 'super_admin'].includes(user.role),
  
  createActivity: (user, lead) => {
    if (['manager', 'org_admin', 'super_admin'].includes(user.role)) return true;
    return lead.assignedToId === user.id;
  },
  
  manageUsers: (user) => ['org_admin', 'super_admin'].includes(user.role),
  
  manageCampaigns: (user) => ['manager', 'org_admin', 'super_admin'].includes(user.role),
  
  viewAnalytics: (user) => ['manager', 'org_admin', 'super_admin'].includes(user.role),
};

/**
 * Middleware to check specific permission
 */
const checkPermission = (permissionCheck) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    const hasPermission = permissionCheck(req.user);
    
    if (!hasPermission) {
      return error(res, 'Insufficient permissions for this action', 403);
    }

    next();
  };
};

module.exports = {
  requireRole,
  requireManagerOrAdmin,
  requireAdmin,
  requireSuperAdmin,
  can,
  checkPermission,
};
