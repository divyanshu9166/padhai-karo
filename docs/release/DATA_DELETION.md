# Data export and deletion

Before publishing, replace the placeholders below with the final support email and hosted-policy URL.

## User choices

- A user can request deletion from the authenticated account endpoint by confirming the deletion
  phrase and password. Deletion removes the account and associated server records through database
  cascade rules, including sessions, profile, study data, notes, uploads stored in the database,
  practice history, messages, and notification preferences.
- A user can contact **[support email]** if they cannot sign in. Verify ownership before acting on
  that request; do not ask for the old password by email.
- Backups expire according to the production backup retention period. Define that period before
  launch and state it in the published Privacy Policy.

## Operator checklist

1. Confirm the authenticated deletion response is a success.
2. Remove any separately configured object-storage files by user ID, if object storage is enabled.
3. Revoke connected calendar tokens/provider credentials if applicable.
4. Record only the request date and completion status in the support system—never store user notes,
   voice recordings, passwords, tokens, or raw study data in support tickets.
