/**
 * reportingLine.js
 * Who should hear about something a user did: their reporting line up to and
 * including their own admin (manager → their admin; sales executive → their
 * manager + that manager's admin). Falls back to the org admins when the chain
 * has no admin (e.g. a legacy user nobody invited).
 */
const prisma = require('./prisma');

const ADMIN_ROLES = ['org_admin', 'super_admin'];

async function getReportingLineIds(user) {
  // Lazy require: teamController itself depends on modules that use this helper
  const { getAncestorIds } = require('../controllers/teamController');
  const chainIds = [...(await getAncestorIds(user))];
  const chainUsers = await prisma.user.findMany({
    where: { id: { in: chainIds }, isActive: true },
    select: { id: true, role: true },
  });
  const byId = new Map(chainUsers.map((u) => [u.id, u]));

  const recipients = [];
  for (const id of chainIds) {
    const u = byId.get(id);
    if (!u) continue;
    recipients.push(u.id);
    if (ADMIN_ROLES.includes(u.role)) break; // stop at their own admin
  }

  if (!chainUsers.some((u) => ADMIN_ROLES.includes(u.role))) {
    const admins = await prisma.user.findMany({
      where: { organizationId: user.organizationId, role: 'org_admin', isActive: true },
      select: { id: true },
    });
    recipients.push(...admins.map((a) => a.id));
  }
  return [...new Set(recipients)];
}

const roleLabel = (role) => (role === 'manager' ? 'Manager' : role === 'sales_user' ? 'Sales Executive' : 'Admin');

module.exports = { getReportingLineIds, roleLabel };
