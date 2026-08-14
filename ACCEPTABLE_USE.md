# Acceptable use

Blop Browser is intended for authorized development, testing, accessibility,
administration, and research workflows. You are responsible for choosing an
authorized target and respecting the rules that apply to it. This guidance is
operational, not legal advice.

## Use the browser responsibly

Before you automate a website or account, confirm all of these conditions:

- You own the target or have permission from its owner or account holder.
- Your workflow follows the website's terms, published automation rules, and
  access controls.
- Your request rate and concurrency stay within published limits and don't
  degrade the service for others.
- You collect only the data needed for the authorized task and handle personal,
  confidential, and authentication data safely.
- A person reviews consequential actions, including publishing, purchasing,
  account changes, and deletion, before they are submitted.

Prefer local fixtures, staging environments, test tenants, and dedicated test
accounts. Stop when a site presents a CAPTCHA, rate-limit response, access
denial, or other control that withholds permission you do not have. Don't
change accounts, addresses, or network routes to defeat that control.

Optional anti-bot mode is off by default. You may enable it for authorized
workflows that need reduced automation signals. Enabling it does not grant
permission, solve a CAPTCHA, or authorize access you do not already have.

## Prohibited uses

Don't use Blop Browser to perform or assist with these activities:

- Accessing an account, system, or data without permission.
- Evading CAPTCHAs, rate limits, bans, paywalls, authentication, robots
  directives, or other technical and policy controls without authorization.
- Credential theft, phishing, malware delivery, fraud, spam, harassment, or
  surveillance.
- Deceptive impersonation, fake engagement, coordinated account creation, or
  manipulation of advertising and ranking systems.
- Disruptive scraping, denial of service, destructive actions, or bulk
  collection of personal or confidential data.
- High-impact decisions about people in employment, housing, credit, insurance,
  education, health care, or legal services without appropriate authorization
  and human oversight.

Chrome DevTools Protocol (CDP) access and optional anti-bot mode don't grant
permission to access a site. Anti-bot mode launches Camoufox to change
browser-observable fingerprints. Blop Browser doesn't promise that this will
avoid bot detection or any other site control. Use either feature only on
targets you are authorized to automate.

## Report abuse

Report a product vulnerability through the `[Security]` process in the
[security policy](SECURITY.md), not as abuse. For suspected malicious or
unauthorized use that isn't a product vulnerability, use the process below.

Report suspected misuse in a
[private GitHub security advisory](https://github.com/blop-oss/blop-browser/security/advisories/new)
and select **Start a private vulnerability report**. Start the title with
`[Abuse]`, so maintainers can distinguish it from a product vulnerability.
Include the affected URL or account, timestamps, relevant commands or logs, and
a short description of the impact. Remove passwords, cookies, tokens, and
unnecessary personal data.

The project designates that private repository inbox for both security and abuse
reports. If GitHub doesn't offer the private form, use
[GitHub's private abuse-reporting form](https://support.github.com/contact/report-abuse).
Don't disclose sensitive reports in a public issue. Maintainers will preserve
confidentiality where practical and may restrict project access or coordinate
with the affected service.
