# Privacy Policy

**Last Updated**: November 24, 2025

GuardScan is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and protect information when you use GuardScan.

---

## 🎯 Core Privacy Principles

1. **Your source code NEVER leaves your machine** (for static analysis)
2. **No code is uploaded** to GuardScan servers
3. **AI features use YOUR API keys** - we never see your code
4. **Telemetry is optional** and can be disabled
5. **All data is anonymized** when telemetry is enabled

---

## 📊 What Information We Collect

### When Telemetry is Enabled (Optional)

If you enable telemetry (default: enabled, can be disabled with `--no-telemetry`), we collect:

1. **Client ID**
   - Anonymous identifier generated on first run
   - Used to track usage patterns (not personal identification)
   - Stored locally in your configuration

2. **Repository ID**
   - Hash of your repository path
   - Used to track repository-level statistics
   - Cannot be reversed to identify your repository

3. **Usage Statistics**
   - Commands executed (e.g., "security", "scan", "run")
   - Lines of code scanned (aggregate counts)
   - Feature usage (which commands are used most)
   - Error types (for debugging, no stack traces)

4. **System Information** (Anonymized)
   - Node.js version
   - Operating system type (not specific version)
   - GuardScan version

### What We Do NOT Collect

- ❌ **Source code** - Never collected or transmitted
- ❌ **File contents** - Never collected or transmitted
- ❌ **API keys** - Never collected or stored
- ❌ **Personal information** - No names, emails, or identifiers
- ❌ **Repository paths** - Only hashed repository IDs
- ❌ **File names** - Not collected
- ❌ **Git history** - Not collected
- ❌ **Network information** - No IP addresses stored

---

## 🔒 How We Use Collected Information

### Telemetry Data Usage

When telemetry is enabled, we use the collected data to:

1. **Product Improvement**
   - Understand which features are most used
   - Identify areas for improvement
   - Prioritize development efforts

2. **Bug Fixes**
   - Identify common error patterns
   - Improve error handling
   - Enhance stability

3. **Analytics**
   - Aggregate usage statistics
   - Measure adoption of features
   - Track version distribution

### Data Storage

- **Location**: Cloudflare Workers (global edge network)
- **Database**: Supabase (PostgreSQL)
- **Retention**: Data is retained for up to 1 year
- **Security**: All data is encrypted in transit and at rest

---

## 🚫 Disabling Telemetry

You can disable telemetry at any time:

### Per-Command

```bash
guardscan --no-telemetry security
```

### Globally

```bash
# Edit your config file
guardscan config

# Or manually edit: ~/.guardscan/config.yaml
# Set telemetry.enabled: false
```

### Environment Variable

```bash
export GUARDSCAN_NO_TELEMETRY=true
guardscan security
```

---

## 🤖 AI Provider Privacy

When you use AI features (code review, documentation generation, etc.):

### Your API Keys

- **Stored locally** in your configuration file (`~/.guardscan/config.yaml`)
- **Never transmitted** to GuardScan servers
- **Sent directly** to your chosen AI provider (OpenAI, Anthropic, etc.)

### Your Code

- **Code snippets** are sent to your AI provider (OpenAI, Claude, etc.)
- **GuardScan does NOT see** your code or AI responses
- **You control** which AI provider receives your code
- **Review your AI provider's privacy policy** (OpenAI, Anthropic, Google, etc.)

### Local AI (Ollama)

- When using Ollama, **everything stays local**
- No data leaves your machine
- No network requests to external services

---

## 📡 Network Communication

### Static Analysis (Offline)

- **No network requests** required
- Works completely offline
- No data transmission

### AI Features

- **Direct connection** to your AI provider
- No GuardScan servers involved
- Your code goes directly to OpenAI/Claude/etc.

### Telemetry (If Enabled)

- **HTTPS only** - All data encrypted in transit
- **Minimal data** - Only metadata, no code
- **Optional** - Can be completely disabled

### Version Checking

- **npm registry** - Checks for updates
- **No personal data** sent
- **Can be disabled** by setting environment variable

---

## 🔐 Data Security

### How We Protect Your Data

1. **Encryption**
   - All data encrypted in transit (HTTPS/TLS)
   - Database encryption at rest
   - Secure API endpoints

2. **Access Control**
   - Limited access to telemetry data
   - No access to source code (we don't collect it)
   - Regular security audits

3. **Infrastructure**
   - Cloudflare Workers (edge network)
   - Supabase (PostgreSQL database)
   - Industry-standard security practices

### Your Data Security

1. **Local Storage**
   - Configuration files stored locally
   - API keys stored in local config
   - Cache files stored locally

2. **Best Practices**
   - Don't commit config files to version control
   - Use environment variables for sensitive data
   - Regularly rotate API keys

---

## 🌍 Data Location

- **Telemetry Data**: Stored in Supabase (PostgreSQL) - location depends on your Supabase region
- **Processing**: Cloudflare Workers (global edge network)
- **Your Code**: Never stored anywhere - stays on your machine

---

## 👥 Third-Party Services

GuardScan uses the following third-party services:

### Required Services

- **npm Registry**: For package installation and version checking
- **AI Providers** (if configured): OpenAI, Anthropic, Google, Ollama

### Optional Services (Telemetry)

- **Cloudflare Workers**: Backend API for telemetry
- **Supabase**: Database for telemetry storage

**Note**: When telemetry is disabled, no data is sent to Cloudflare or Supabase.

---

## 🔄 Data Retention and Deletion

### Telemetry Data

- **Retention**: Up to 1 year
- **Deletion**: You can request deletion by emailing <ntanwir10@outlook.com>
- **Anonymization**: Data is anonymized and cannot be linked to individuals

### Local Data

- **Configuration**: Stored locally, you control it
- **Cache**: Stored locally, can be cleared with `guardscan reset`
- **Logs**: Stored locally, you control retention

---

## 👶 Children's Privacy

GuardScan is not intended for users under 13 years of age. We do not knowingly collect personal information from children.

---

## 🔄 Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be:

- Posted on this page
- Dated with "Last Updated" timestamp
- Communicated via GitHub releases for significant changes

---

## 📧 Contact Us

For privacy-related questions or concerns:

- **Email**: <ntanwir10@outlook.com>
- **GitHub Issues**: For general questions (not sensitive privacy matters)

---

## ✅ Your Rights

You have the right to:

1. **Disable telemetry** at any time
2. **Request data deletion** (email <ntanwir10@outlook.com>)
3. **Access your data** (if telemetry is enabled)
4. **Use GuardScan completely offline** (no telemetry, no network)

---

## 📋 Summary

**What GuardScan Collects (if telemetry enabled):**

- Anonymous client ID
- Hashed repository ID
- Usage statistics (commands, LOC counts)
- System information (Node.js version, OS type)

**What GuardScan Does NOT Collect:**

- Source code
- File contents
- API keys
- Personal information
- Repository paths
- File names

**Your Control:**

- ✅ Disable telemetry anytime
- ✅ Use completely offline
- ✅ Control your API keys
- ✅ Your code never leaves your machine (for static analysis)

---

**GuardScan is committed to privacy-first development. Your code stays yours.**

---

*Last Updated: 2025-11-24*
