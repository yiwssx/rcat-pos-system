# Security policy (project setup phase)

No production release exists; do not use this repository for real payments yet.

If you find a security issue, do not publish attack details, credentials or customer/payment data in a public issue. Contact the repository owner privately; GitHub Private Vulnerability Reporting should be enabled when available before public deployment.

## Security baseline
- No real secrets committed; use scoped environment secrets.
- Authentication and authorization at every relevant API boundary.
- Tenant separation tests and full auditability for money-related operations.
- Verify provider signatures and payment state on the server.
- Prepare backups, incident response and retention policy before pilot.

Security documentation and notification contact are to be finalized under issue #10.

