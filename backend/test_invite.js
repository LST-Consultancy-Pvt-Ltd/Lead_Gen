const prisma = require('./src/utils/prisma');
const crypto = require('crypto');

async function test() {
  try {
    const admin = await prisma.user.findFirst({ where: { role: 'org_admin' }, include: { organization: true } });
    console.log('Admin found:', admin ? admin.email : 'NONE');
    if (!admin) { console.error('No admin user found — run seed first'); return; }
    console.log('Admin organizationId:', admin.organizationId);

    // Check for existing pending invite
    const existing = await prisma.invitation.findFirst({
      where: { email: 'test_invite@example.com', organizationId: admin.organizationId }
    });
    if (existing) {
      await prisma.invitation.delete({ where: { id: existing.id } });
      console.log('Cleaned up old test invite');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const inv = await prisma.invitation.create({
      data: {
        organizationId: admin.organizationId,
        email: 'test_invite@example.com',
        role: 'manager',
        invitedById: admin.id,
        managerId: null,
        token,
        status: 'pending',
        expiresAt,
      }
    });
    console.log('SUCCESS — Invitation created:', inv.id);
    await prisma.invitation.delete({ where: { id: inv.id } });
    console.log('Cleaned up. Invitation flow works!');
  } catch(e) {
    console.error('FAILED:', e.message);
    console.error('Prisma error code:', e.code);
    console.error('Meta:', JSON.stringify(e.meta));
  } finally {
    await prisma.$disconnect();
  }
}

test();
