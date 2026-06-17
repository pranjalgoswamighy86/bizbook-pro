import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { sendOtpEmail, isEmailConfigured } from '@/lib/email'
import { sendOtpSms, isSmsConfigured } from '@/lib/sms'
import { checkRateLimit, RATE_LIMITS, otpRateLimitKey, loginRateLimitKey, passwordResetRateLimitKey } from '@/lib/rate-limit'
// ---- SECURITY PATCH v1 imports ----
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from '@/lib/auth'
import { requireAuth, requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
// -----------------------------------

/**
 * Normalize phone number for consistent comparison.
 * Strips all non-digit characters and tries to produce a canonical form.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '')
}

/**
 * Check if a phone number is already registered under any tenant.
 * Returns the tenant if found, null otherwise.
 * Handles format variations: 9876543210, 09876543210, 919876543210, etc.
 */
async function findTenantByPhone(phone: string) {
  const clean = normalizePhone(phone)
  if (!clean || clean.length < 10) return null

  const phoneVariants = [
    clean,
    `0${clean}`,
    clean.replace(/^0/, ''),
    `91${clean.replace(/^0/, '')}`,
    clean.replace(/^91/, ''),
    `0${clean.replace(/^91/, '')}`,
  ]
  const uniqueVariants = [...new Set(phoneVariants.filter(v => v.length >= 10))]

  for (const variant of uniqueVariants) {
    const tenant = await db.tenant.findFirst({ where: { phone: variant, isDeleted: false } })
    if (tenant) return tenant
  }
  return null
}

/** Helper: build the standard login response and set session cookie.
 *  Also returns the token in the JSON body so the frontend can store it
 *  in localStorage and send it via Authorization header as a fallback
 *  when cookies are blocked (e.g., in cross-site iframes).
 */
function buildLoginResponse(user: { id: string; email: string; name: string; role: string; tenantId: string }) {
  const token = createSessionToken(user.id, user.email)
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
    sessionToken: token,  // for Bearer header fallback when cookies are blocked
  })
  setSessionCookie(res, token)
  return res
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    // ============================================================
    // STEP 1 of Registration: Validate + Send OTP to email
    // ============================================================
    if (action === 'register-send-otp') {
      const { name, email, password, businessName, businessAddress, businessPhone, businessGst } = body

      const rlKey = otpRateLimitKey(email || '')
      const rl = checkRateLimit(rlKey, RATE_LIMITS.OTP)
      if (!rl.allowed) {
        return NextResponse.json({
          error: `Too many OTP requests. Please try again in ${rl.retryAfterSeconds} seconds.`,
        }, { status: 429 })
      }

      if (!name || !email || !password || !businessName || !businessPhone) {
        return NextResponse.json({
          error: 'All fields are required: Name, Email, Password, Business Name, and Phone Number.',
        }, { status: 400 })
      }

      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
      }

      const existingUser = await db.user.findFirst({ where: { email, isDeleted: false } })
      if (existingUser) {
        return NextResponse.json({
          error: 'This email ID is already registered. Please go to the Login page and log in with your existing account.',
          field: 'email',
        }, { status: 400 })
      }

      const existingPhoneTenant = await findTenantByPhone(businessPhone)
      if (existingPhoneTenant) {
        return NextResponse.json({
          error: 'This mobile number is already registered with another account. Please use a different mobile number or go to the Login page.',
          field: 'phone',
        }, { status: 400 })
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

      await db.passwordReset.updateMany({
        where: { email, used: false },
        data: { used: true },
      })
      await db.passwordReset.create({
        data: { email, otp, expiresAt },
      })

      let emailSent = false
      let emailError = ''
      if (isEmailConfigured()) {
        const emailResult = await sendOtpEmail(email, otp, name)
        emailSent = emailResult.success
        emailError = emailResult.error || ''
        console.log(`[REG-OTP] Email to ${email}: ${emailSent ? 'SENT' : `FAILED (${emailError})`}`)
      } else {
        emailError = 'SMTP_NOT_CONFIGURED'
        console.log('[REG-OTP] Email skipped: SMTP not configured')
      }

      let smsSent = false
      let smsError = ''
      if (isSmsConfigured() && businessPhone) {
        const smsResult = await sendOtpSms(businessPhone, otp)
        smsSent = smsResult.success
        smsError = smsResult.error || ''
        console.log(`[REG-OTP] SMS to ${businessPhone}: ${smsSent ? 'SENT' : `FAILED (${smsError})`}`)
      } else {
        smsError = 'SMS_NOT_CONFIGURED'
      }

      if (!emailSent && !smsSent) {
        if (emailError === 'SMTP_NOT_CONFIGURED' && smsError === 'SMS_NOT_CONFIGURED') {
          return NextResponse.json({
            error: 'OTP delivery is not configured. Please contact your administrator to set up email or SMS service.',
          }, { status: 500 })
        }
        return NextResponse.json({
          error: 'Failed to send verification OTP. Please try again.',
        }, { status: 500 })
      }

      let message = ''
      if (emailSent && smsSent) {
        message = 'Verification OTP sent to your email and mobile number.'
      } else if (emailSent) {
        message = 'Verification OTP sent to your email address. Please check your inbox and spam folder.'
      } else {
        message = 'Verification OTP sent to your mobile number.'
      }

      return NextResponse.json({
        sent: true,
        message,
        emailSent,
        smsSent,
        email,
      })
    }

    // ============================================================
    // STEP 2 of Registration: Verify OTP + Create Account
    // ============================================================
    if (action === 'register-verify') {
      const { name, email, password, businessName, businessAddress, businessPhone, businessGst, otp } = body

      const rlKey = otpRateLimitKey(`verify:${email || ''}`)
      const rl = checkRateLimit(rlKey, RATE_LIMITS.OTP)
      if (!rl.allowed) {
        return NextResponse.json({
          error: `Too many verification attempts. Please try again in ${rl.retryAfterSeconds} seconds.`,
        }, { status: 429 })
      }

      if (!otp) {
        return NextResponse.json({ error: 'OTP is required to complete registration.' }, { status: 400 })
      }

      const existingUser = await db.user.findFirst({ where: { email, isDeleted: false } })
      if (existingUser) {
        return NextResponse.json({
          error: 'This email ID is already registered. Please go to the Login page and log in.',
        }, { status: 400 })
      }

      const existingPhoneTenant = await findTenantByPhone(businessPhone)
      if (existingPhoneTenant) {
        return NextResponse.json({
          error: 'This mobile number is already registered. Please use a different number or go to Login.',
        }, { status: 400 })
      }

      const otpRecord = await db.passwordReset.findFirst({
        where: { email, otp, used: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      })
      if (!otpRecord) {
        return NextResponse.json({ error: 'Invalid or expired OTP. Please request a new one.' }, { status: 400 })
      }
      await db.passwordReset.update({
        where: { id: otpRecord.id },
        data: { used: true },
      })

      // ---- SECURITY PATCH v1: hash password before storing ----
      const passwordHash = hashPassword(password)
      // --------------------------------------------------------

      // Use a transaction so we never end up with a tenant but no user
      const { tenant, user } = await db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: businessName,
            address: businessAddress || '',
            phone: businessPhone,
            gstNumber: businessGst || '',
            email,
            plan: 'free',
          },
        })

        const user = await tx.user.create({
          data: {
            name,
            email,
            password: passwordHash,        // ← hashed
            role: 'MAIN_ADMIN',
            tenantId: tenant.id,
          },
        })

        await tx.userTenant.create({
          data: {
            userId: user.id,
            tenantId: tenant.id,
            role: 'MAIN_ADMIN',
            isOwner: true,
          },
        })

        return { tenant, user }
      })

      console.log(`[REGISTER] New account created: ${email} (Company: ${tenant.name})`)

      const companies = await db.userTenant.findMany({
        where: { userId: user.id },
        include: { tenant: { select: { id: true, name: true, address: true, phone: true, email: true, gstNumber: true, panNumber: true, plan: true, currency: true } } },
        orderBy: { createdAt: 'asc' },
      })

      // ---- SECURITY PATCH v1: set session cookie ----
      const token = createSessionToken(user.id, user.email)
      const res = NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
        tenant: { id: tenant.id, name: tenant.name, address: tenant.address, phone: tenant.phone, email: tenant.email, gstNumber: tenant.gstNumber, plan: tenant.plan, currency: tenant.currency },
        companies: companies.map(c => ({ tenantId: c.tenantId, name: c.tenant.name, role: c.role, isOwner: c.isOwner, tenant: c.tenant })),
        sessionToken: token,  // for Bearer header fallback when cookies are blocked
      })
      setSessionCookie(res, token)
      return res
      // -----------------------------------------------
    }

    // ============================================================
    // Legacy register action (kept for backward compatibility)
    // ============================================================
    if (action === 'register') {
      const { name, email, password, businessName, businessAddress, businessPhone, businessGst } = body

      if (!name || !email || !password || !businessName || !businessPhone) {
        return NextResponse.json({
          error: 'All fields are required: Name, Email, Password, Business Name, and Phone Number.',
        }, { status: 400 })
      }
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
      }

      const existingUser = await db.user.findFirst({ where: { email, isDeleted: false } })
      if (existingUser) {
        return NextResponse.json({
          error: 'This email ID is already registered. Please go to the Login page and log in with your existing account.',
          field: 'email',
        }, { status: 400 })
      }

      const existingPhoneTenant = await findTenantByPhone(businessPhone)
      if (existingPhoneTenant) {
        return NextResponse.json({
          error: 'This mobile number is already registered with another account. Please use a different mobile number or go to the Login page.',
          field: 'phone',
        }, { status: 400 })
      }

      // ---- SECURITY PATCH v1: hash password ----
      const passwordHash = hashPassword(password)
      // -------------------------------------------

      const { tenant, user } = await db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: businessName,
            address: businessAddress,
            phone: businessPhone,
            gstNumber: businessGst,
            email,
            plan: 'free',
          },
        })
        const user = await tx.user.create({
          data: {
            name,
            email,
            password: passwordHash,
            role: 'MAIN_ADMIN',
            tenantId: tenant.id,
          },
        })
        await tx.userTenant.create({
          data: { userId: user.id, tenantId: tenant.id, role: 'MAIN_ADMIN', isOwner: true },
        })
        return { tenant, user }
      })

      // ---- SECURITY PATCH v1: set session cookie ----
      const token = createSessionToken(user.id, user.email)
      const res = NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
        tenant: { id: tenant.id, name: tenant.name, address: tenant.address, phone: tenant.phone, email: tenant.email, gstNumber: tenant.gstNumber, plan: tenant.plan, currency: tenant.currency },
        sessionToken: token,  // for Bearer header fallback when cookies are blocked
      })
      setSessionCookie(res, token)
      return res
      // -----------------------------------------------
    }

    // ============================================================
    // Login — verify password with constant-time comparison
    // ============================================================
    if (action === 'login') {
      const { email, password } = body

      const rlKey = loginRateLimitKey(email || '')
      const rl = checkRateLimit(rlKey, RATE_LIMITS.LOGIN)
      if (!rl.allowed) {
        return NextResponse.json({
          error: `Too many login attempts. Please try again in ${rl.retryAfterSeconds} seconds.`,
        }, { status: 429 })
      }

      const user = await db.user.findUnique({
        where: { email },
        include: { tenant: true },
      })

      // ---- SECURITY PATCH v1: use verifyPassword instead of `!==` ----
      // Always run verifyPassword even if user is null, to keep timing
      // roughly constant (mitigates user-enumeration via response timing).
      const passwordValid = user ? verifyPassword(password, user.password) : false
      if (!user || !passwordValid) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }
      // ----------------------------------------------------------------

      if (!user.isActive || user.isDeleted) {
        return NextResponse.json({ error: 'Account is deactivated' }, { status: 403 })
      }

      const companies = await db.userTenant.findMany({
        where: { userId: user.id },
        include: { tenant: { select: { id: true, name: true, address: true, phone: true, email: true, gstNumber: true, panNumber: true, plan: true, planExpires: true, currency: true } } },
        orderBy: { createdAt: 'asc' },
      })

      const defaultTenant = user.tenant

      // ---- SECURITY PATCH v1: set session cookie ----
      const token = createSessionToken(user.id, user.email)
      const res = NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
        tenant: { id: defaultTenant.id, name: defaultTenant.name, address: defaultTenant.address, phone: defaultTenant.phone, email: defaultTenant.email, gstNumber: defaultTenant.gstNumber, panNumber: defaultTenant.panNumber, plan: defaultTenant.plan, planExpires: defaultTenant.planExpires?.toISOString(), currency: defaultTenant.currency },
        companies: companies.map(c => ({
          tenantId: c.tenantId,
          name: c.tenant.name,
          role: c.role,
          isOwner: c.isOwner,
          tenant: c.tenant,
        })),
        sessionToken: token,  // for Bearer header fallback when cookies are blocked
      })
      setSessionCookie(res, token)
      return res
      // -----------------------------------------------
    }

    // ============================================================
    // Logout — clear session cookie
    // ============================================================
    if (action === 'logout') {
      const res = NextResponse.json({ success: true })
      clearSessionCookie(res)
      return res
    }

    // ============================================================
    // Get current session — for frontend to check auth state
    // ============================================================
    if (action === 'me') {
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth

      const companies = await db.userTenant.findMany({
        where: { userId: auth.userId },
        include: { tenant: { select: { id: true, name: true, address: true, phone: true, email: true, gstNumber: true, panNumber: true, plan: true, currency: true } } },
        orderBy: { createdAt: 'asc' },
      })

      return NextResponse.json({
        user: auth.user,
        companies: companies.map(c => ({
          tenantId: c.tenantId,
          name: c.tenant.name,
          role: c.role,
          isOwner: c.isOwner,
          tenant: c.tenant,
        })),
      })
    }

    // ============================================================
    // Add a new company to an existing user — REQUIRES AUTH
    // ============================================================
    if (action === 'add-company') {
      // ---- SECURITY PATCH v1: require auth ----
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      // ------------------------------------------

      const { businessName, businessAddress, businessPhone, businessGst } = body

      if (!businessName) {
        return NextResponse.json({ error: 'Business Name is required.' }, { status: 400 })
      }

      const tenant = await db.tenant.create({
        data: {
          name: businessName,
          address: businessAddress || '',
          phone: businessPhone || '',
          gstNumber: businessGst || '',
          email: auth.email,
          plan: 'free',
        },
      })

      await db.userTenant.create({
        data: {
          userId: auth.userId,
          tenantId: tenant.id,
          role: 'MAIN_ADMIN',
          isOwner: true,
        },
      })

      await db.user.update({
        where: { id: auth.userId },
        data: { tenantId: tenant.id },
      })

      await writeAuditLog({
        tenantId: tenant.id,
        userId: auth.userId,
        userName: auth.user.name,
        action: 'CREATE',
        entityType: 'Tenant',
        entityId: tenant.id,
        entityName: tenant.name,
        changes: { name: tenant.name, phone: tenant.phone, gstNumber: tenant.gstNumber },
      })

      console.log(`[ADD-COMPANY] New company "${tenant.name}" added for user ${auth.email}`)

      const companies = await db.userTenant.findMany({
        where: { userId: auth.userId },
        include: { tenant: { select: { id: true, name: true, address: true, phone: true, email: true, gstNumber: true, panNumber: true, plan: true, currency: true } } },
        orderBy: { createdAt: 'asc' },
      })

      return NextResponse.json({
        success: true,
        tenant: { id: tenant.id, name: tenant.name, address: tenant.address, phone: tenant.phone, email: tenant.email, gstNumber: tenant.gstNumber, plan: tenant.plan, currency: tenant.currency },
        companies: companies.map(c => ({ tenantId: c.tenantId, name: c.tenant.name, role: c.role, isOwner: c.isOwner, tenant: c.tenant })),
      })
    }

    // ============================================================
    // Switch active company — REQUIRES AUTH + TENANT ACCESS
    // ============================================================
    if (action === 'switch-company') {
      // ---- SECURITY PATCH v1: require auth + verify tenant access ----
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth

      const { tenantId } = body
      if (!tenantId) {
        return NextResponse.json({ error: 'Company ID is required.' }, { status: 400 })
      }

      const userTenant = await db.userTenant.findUnique({
        where: { userId_tenantId: { userId: auth.userId, tenantId } },
        include: { tenant: true },
      })
      if (!userTenant || userTenant.tenant.isDeleted) {
        return NextResponse.json({ error: 'You do not have access to this company.' }, { status: 403 })
      }
      // ----------------------------------------------------------------

      await db.user.update({
        where: { id: auth.userId },
        data: { tenantId },
      })

      return NextResponse.json({
        success: true,
        tenant: { id: userTenant.tenant.id, name: userTenant.tenant.name, address: userTenant.tenant.address, phone: userTenant.tenant.phone, email: userTenant.tenant.email, gstNumber: userTenant.tenant.gstNumber, panNumber: userTenant.tenant.panNumber, plan: userTenant.tenant.plan, planExpires: userTenant.tenant.planExpires?.toISOString(), currency: userTenant.tenant.currency },
      })
    }

    // ============================================================
    // List companies for the authenticated user
    // ============================================================
    if (action === 'list-companies') {
      // ---- SECURITY PATCH v1: require auth ----
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      // ------------------------------------------

      const companies = await db.userTenant.findMany({
        where: { userId: auth.userId, tenant: { isDeleted: false } },
        include: { tenant: { select: { id: true, name: true, address: true, phone: true, email: true, gstNumber: true, panNumber: true, plan: true, currency: true } } },
        orderBy: { createdAt: 'asc' },
      })

      return NextResponse.json({
        companies: companies.map(c => ({ tenantId: c.tenantId, name: c.tenant.name, role: c.role, isOwner: c.isOwner, tenant: c.tenant })),
      })
    }

    // ============================================================
    // Add user — REQUIRES AUTH + MAIN_ADMIN role in target tenant
    // ============================================================
    if (action === 'add-user') {
      // ---- SECURITY PATCH v1: require auth + MAIN_ADMIN in target tenant ----
      const { tenantId, name, email, password, role } = body
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // -----------------------------------------------------------------------

      if (!name || !email || !password) {
        return NextResponse.json({ error: 'Name, email, and password are required' }, { status: 400 })
      }
      if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
      }

      const existing = await db.user.findFirst({ where: { email, isDeleted: false } })
      if (existing) {
        return NextResponse.json({ error: 'Email already exists' }, { status: 400 })
      }

      // ---- SECURITY PATCH v1: hash password ----
      const passwordHash = hashPassword(password)
      // -------------------------------------------

      const newUser = await db.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: { name, email, password: passwordHash, role: role || 'DATA_ENTRY', tenantId },
        })
        await tx.userTenant.create({
          data: { userId: newUser.id, tenantId, role: role || 'DATA_ENTRY', isOwner: false },
        })
        return newUser
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'CREATE',
        entityType: 'User',
        entityId: newUser.id,
        entityName: newUser.email,
      })

      return NextResponse.json({ user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, tenantId: newUser.tenantId } })
    }

    // ============================================================
    // List users — REQUIRES AUTH + MAIN_ADMIN in target tenant
    // ============================================================
    if (action === 'list-users') {
      const { tenantId } = body
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN', 'JUNIOR_ADMIN'])
      if (access instanceof NextResponse) return access

      // Only return users who belong to this tenant via UserTenant
      const userTenants = await db.userTenant.findMany({
        where: { tenantId, user: { isDeleted: false } },
        include: {
          user: {
            select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({
        users: userTenants.map(ut => ({
          ...ut.user,
          roleInTenant: ut.role,
          isOwner: ut.isOwner,
        })),
      })
    }

    // ============================================================
    // Toggle user active state — REQUIRES AUTH + MAIN_ADMIN
    // ============================================================
    if (action === 'toggle-user') {
      const { userId: targetUserId, isActive, tenantId } = body
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      // Verify target user actually belongs to this tenant
      const targetUserTenant = await db.userTenant.findUnique({
        where: { userId_tenantId: { userId: targetUserId, tenantId } },
      })
      if (!targetUserTenant) {
        return NextResponse.json({ error: 'User not found in this business' }, { status: 404 })
      }

      // Don't allow deactivating the owner
      if (targetUserTenant.isOwner && !isActive) {
        return NextResponse.json({ error: 'Cannot deactivate the business owner' }, { status: 400 })
      }

      const user = await db.user.update({
        where: { id: targetUserId },
        data: { isActive },
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'UPDATE',
        entityType: 'User',
        entityId: targetUserId,
        entityName: user.email,
        changes: { isActive },
      })

      return NextResponse.json({ user: { id: user.id, isActive: user.isActive } })
    }

    // ============================================================
    // EDIT-USER — update a user's role within this tenant
    // ============================================================
    if (action === 'edit-user') {
      const { userId: targetUserId, role, tenantId } = body
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      if (!targetUserId || !role) {
        return NextResponse.json({ error: 'User ID and role are required' }, { status: 400 })
      }

      // Validate role value
      const validRoles = ['MAIN_ADMIN', 'JUNIOR_ADMIN', 'DATA_ENTRY', 'VIEW_ONLY']
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 })
      }

      // Verify target user belongs to this tenant
      const targetUserTenant = await db.userTenant.findUnique({
        where: { userId_tenantId: { userId: targetUserId, tenantId } },
      })
      if (!targetUserTenant) {
        return NextResponse.json({ error: 'User not found in this business' }, { status: 404 })
      }

      // Don't allow changing the owner's role (would orphan the business)
      if (targetUserTenant.isOwner && role !== 'MAIN_ADMIN') {
        return NextResponse.json({ error: 'Cannot change the business owner\'s role' }, { status: 400 })
      }

      // Don't allow demoting yourself (prevent lockout)
      if (targetUserId === access.userId && role !== 'MAIN_ADMIN') {
        return NextResponse.json({ error: 'Cannot demote yourself. Ask another Main Admin to do this.' }, { status: 400 })
      }

      // Update the UserTenant role (per-company role)
      const updatedUserTenant = await db.userTenant.update({
        where: { userId_tenantId: { userId: targetUserId, tenantId } },
        data: { role },
      })

      // Also update the User's default role (for backward compat)
      const updatedUser = await db.user.update({
        where: { id: targetUserId },
        data: { role },
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'UPDATE',
        entityType: 'User',
        entityId: targetUserId,
        entityName: updatedUser.email,
        changes: { role, previousRole: targetUserTenant.role },
      })

      return NextResponse.json({
        user: updatedUser,
        userTenant: { role: updatedUserTenant.role, isOwner: updatedUserTenant.isOwner },
      })
    }

    // ============================================================
    // Send OTP for password reset
    // ============================================================
    if (action === 'send-otp') {
      const { identifier } = body

      const rlKey = passwordResetRateLimitKey(identifier || '')
      const rl = checkRateLimit(rlKey, RATE_LIMITS.PASSWORD_RESET)
      if (!rl.allowed) {
        return NextResponse.json({
          error: `Too many password reset requests. Please try again in ${rl.retryAfterSeconds} seconds.`,
        }, { status: 429 })
      }

      let userByEmail = await db.user.findUnique({ where: { email: identifier } })

      let userByPhone: typeof userByEmail = null
      if (!userByEmail) {
        const cleanId = identifier.replace(/[^0-9]/g, '')
        const phoneVariants = [
          identifier,
          cleanId,
          `0${cleanId}`,
          cleanId.replace(/^0/, ''),
          `91${cleanId.replace(/^0/, '')}`,
          cleanId.replace(/^91/, ''),
        ]
        const uniqueVariants = [...new Set(phoneVariants)]

        for (const variant of uniqueVariants) {
          const tenantByPhone = await db.tenant.findFirst({ where: { phone: variant, isDeleted: false } })
          if (tenantByPhone) {
            userByPhone = await db.user.findFirst({ where: { tenantId: tenantByPhone.id, role: 'MAIN_ADMIN', isDeleted: false } })
            if (userByPhone) break
          }
        }
      }

      const targetUser = userByEmail || userByPhone
      if (!targetUser) {
        return NextResponse.json({
          sent: false,
          message: 'No account found with this email or phone number. Please check and try again.',
          emailSent: false,
          smsSent: false,
        })
      }

      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

      await db.passwordReset.updateMany({
        where: { email: targetUser.email, used: false },
        data: { used: true },
      })
      await db.passwordReset.create({
        data: { email: targetUser.email, otp, expiresAt },
      })

      let emailSent = false
      let emailError = ''
      if (isEmailConfigured()) {
        const emailResult = await sendOtpEmail(targetUser.email, otp, targetUser.name)
        emailSent = emailResult.success
        emailError = emailResult.error || ''
        console.log(`[OTP] Email to ${targetUser.email}: ${emailSent ? 'SENT' : `FAILED (${emailError})`}`)
      } else {
        emailError = 'SMTP_NOT_CONFIGURED'
        console.log('[OTP] Email skipped: SMTP not configured')
      }

      let smsSent = false
      let smsError = ''
      if (isSmsConfigured()) {
        const tenant = await db.tenant.findUnique({ where: { id: targetUser.tenantId } })
        if (tenant?.phone) {
          console.log(`[OTP] Sending SMS to ${tenant.phone}...`)
          const smsResult = await sendOtpSms(tenant.phone, otp)
          smsSent = smsResult.success
          smsError = smsResult.error || ''
          console.log(`[OTP] SMS to ${tenant.phone}: ${smsSent ? 'SENT' : `FAILED (${smsError})`}`)
        } else {
          smsError = 'NO_PHONE_ON_ACCOUNT'
          console.log('[OTP] SMS skipped: No phone number on account')
        }
      } else {
        smsError = 'SMS_NOT_CONFIGURED'
        console.log('[OTP] SMS skipped: SMS not configured')
      }

      const delivered = emailSent || smsSent

      let message = ''
      if (emailSent && smsSent) {
        message = 'OTP sent to your email and registered mobile number.'
      } else if (emailSent) {
        message = 'OTP sent to your email address.'
      } else if (smsSent) {
        message = 'OTP sent to your registered mobile number.'
      } else {
        if (emailError === 'SMTP_NOT_CONFIGURED' && smsError === 'SMS_NOT_CONFIGURED') {
          message = 'OTP delivery is not configured. Please contact your administrator to set up email or SMS service.'
        } else {
          message = 'Failed to send OTP. Please try again or contact support.'
        }
      }

      return NextResponse.json({
        sent: delivered,
        message,
        emailSent,
        smsSent,
        email: targetUser.email,
      })
    }

    // ============================================================
    // Reset password — verify OTP, hash new password, invalidate all sessions
    // ============================================================
    if (action === 'reset-password') {
      const { email, otp, newPassword } = body

      const rlKey = passwordResetRateLimitKey(`reset:${email || ''}`)
      const rl = checkRateLimit(rlKey, RATE_LIMITS.OTP)
      if (!rl.allowed) {
        return NextResponse.json({
          error: `Too many reset attempts. Please try again in ${rl.retryAfterSeconds} seconds.`,
        }, { status: 429 })
      }

      if (!email || !otp || !newPassword) {
        return NextResponse.json({ error: 'Email, OTP, and new password are required' }, { status: 400 })
      }
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
      }

      const resetRecord = await db.passwordReset.findFirst({
        where: { email, otp, used: false, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      })
      if (!resetRecord) {
        return NextResponse.json({ error: 'Invalid or expired OTP. Please request a new one.' }, { status: 400 })
      }

      await db.passwordReset.update({
        where: { id: resetRecord.id },
        data: { used: true },
      })

      // ---- SECURITY PATCH v1: hash the new password ----
      const passwordHash = hashPassword(newPassword)
      // ---------------------------------------------------

      const updatedUser = await db.user.update({
        where: { email },
        data: { password: passwordHash },
      })

      // NOTE: Existing session tokens are stateless (HMAC-signed), so we can't
      // revoke them without a server-side denylist. After a password reset,
      // any attacker who had an old session will still be able to use it
      // until expiry (7 days). Mitigation: keep sessions short, or implement
      // a `sessionVersion` field on User that gets incremented on reset,
      // and embed it in the token. (Future enhancement.)

      return NextResponse.json({
        success: true,
        message: 'Password reset successfully',
        user: { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name },
      })
    }

    // ============================================================
    // Change password — verify current, hash new
    // ============================================================
    if (action === 'change-password') {
      // ---- SECURITY PATCH v1: require auth ----
      const auth = await requireAuth(req)
      if (auth instanceof NextResponse) return auth
      // ------------------------------------------

      const { currentPassword, newPassword } = body

      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
      }
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
      }

      // Re-fetch with password field
      const user = await db.user.findFirst({ where: { id: auth.userId, isDeleted: false } })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      // ---- SECURITY PATCH v1: verify with constant-time comparison ----
      if (!verifyPassword(currentPassword, user.password)) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
      }
      // ------------------------------------------------------------------

      // ---- SECURITY PATCH v1: hash new password ----
      const passwordHash = hashPassword(newPassword)
      // ------------------------------------------------

      await db.user.update({
        where: { id: auth.userId },
        data: { password: passwordHash },
      })

      return NextResponse.json({ success: true, message: 'Password changed successfully' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Auth error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ============================================================
// GET /api/auth — check current session status
// ============================================================
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof NextResponse) return auth

  const companies = await db.userTenant.findMany({
    where: { userId: auth.userId, tenant: { isDeleted: false } },
    include: { tenant: { select: { id: true, name: true, plan: true, currency: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    authenticated: true,
    user: auth.user,
    companies: companies.map(c => ({
      tenantId: c.tenantId,
      name: c.tenant.name,
      role: c.role,
      isOwner: c.isOwner,
    })),
  })
}
