# Security Policy — BizBook Pro

## 🔒 Secret Management

### NEVER commit secrets to git

All secrets must be stored as **Railway environment variables**, NEVER in source code.

### Secret scanning

This repository includes automated secret scanning:

1. **Pre-commit hook** (`scripts/pre-commit-secret-scan.sh`)
   - Scans staged files for API keys, tokens, and passwords
   - Blocks the commit if any secret is detected
   - Install: `cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`

2. **GitHub Actions secret scanning** (`.github/workflows/secret-scan.yml`)
   - Runs on every push and pull request
   - Uses TruffleHog to scan all files and git history
   - Fails the build if secrets are found

### What counts as a secret

| Type | Pattern | Example |
|---|---|---|
| Razorpay keys | `rzp_live_*`, `rzp_test_*` | `rzp_live_T7MZNVB6eOvAUR` |
| Brevo/Sendinblue keys | `xkeysib-*` | `xkeysib-9b1429d0a89...` |
| Stripe keys | `sk_live_*`, `sk_test_*` | `sk_live_abc123...` |
| JWT tokens | `eyJhbGciOi...` | `eyJhbGciOiJIUzI1NiIs...` |
| Database URLs | `postgresql://user:pass@host` | `postgresql://postgres:ztiuIMNE...` |
| AWS keys | `AKIA*` | `AKIAIOSFODNN7EXAMPLE` |
| GitHub tokens | `ghp_*`, `gho_*` | `ghp_abc123...` |
| API keys | `sk-ant-*`, `OPENAI_API_KEY=sk-*` | `sk-ant-api03-...` |

### Files that MUST NOT be committed

```
.env
.env.local
.env.production
.env.*.local
.z-ai-config
*.pem
*.key
*.cert
credentials.json
service-account.json
worklog.md
secrets/
```

All of these are in `.gitignore`.

### Where secrets SHOULD be stored

| Secret | Location |
|---|---|
| DATABASE_URL | Railway → Variables |
| SESSION_SECRET | Railway → Variables |
| RAZORPAY_KEY_ID | Railway → Variables |
| RAZORPAY_KEY_SECRET | Railway → Variables |
| BREVO_API_KEY | Railway → Variables |
| TWOFACTOR_API_KEY | Railway → Variables |
| ZAI credentials | `.z-ai-config` (NOT in git) |

## 🚨 If a secret is accidentally committed

1. **Rotate the secret IMMEDIATELY** — generate a new key in the provider's dashboard
2. Update the secret in Railway → Variables
3. Remove the secret from the file
4. Commit the fix
5. Consider purging git history if the secret is sensitive (see below)

## 🧹 Purging git history (advanced)

If a secret was committed and you need to remove it from ALL history:

```bash
# Using git filter-branch (slow but built-in)
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .z-ai-config' \
  --prune-empty --tag-name-filter cat -- --all

# Force push (WARNING: rewrites history)
git push origin --force --all
git push origin --force --tags
```

**After purging, ALL collaborators must re-clone the repository.**

## 📋 Security checklist for developers

Before committing, verify:
- [ ] No API keys, passwords, or tokens in the code
- [ ] All secrets come from `process.env.*`
- [ ] No `.env` files staged
- [ ] No `.z-ai-config` staged
- [ ] No `worklog.md` staged
- [ ] Pre-commit hook is installed and passing

---

© 2026 Tahigo International. All rights reserved.
