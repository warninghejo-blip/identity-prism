# Security Policy

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, pull request, log, screenshot, or demo data.

Use GitHub's private vulnerability reporting for this repository:

https://github.com/warninghejo-blip/identity-prism/security/advisories/new

If that form is unavailable, ask a maintainer for a private reporting channel without including exploit details in the public request.

Include the affected commit or release, impacted component, security impact, minimal reproduction, and any suggested mitigation. Remove API keys, wallet secrets, user data, database contents, and production logs from the report. Maintainers will coordinate disclosure and remediation through the private advisory.

## Scope

Reports about authentication, authorization, signing, wallet operations, payment verification, game settlement, API abuse, sensitive-data exposure, dependency compromise, and build or deployment integrity are in scope. General support requests and findings that require unsafe testing against production users are out of scope.

Test only with accounts, wallets, data, and infrastructure you own or are explicitly authorized to use. Do not degrade service, access other users' data, or move real funds.
