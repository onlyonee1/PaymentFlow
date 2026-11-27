# School finance administrator guide

This guide is for school finance staff using PaymentFlow for everyday fee and payment work. It describes the screens available in the current application and avoids technical setup instructions.

Use the school account and school workspace assigned to you. Only handle student and payment information you are authorised to see. Never include real student details, passwords, MFA codes, or recovery codes in screenshots or support requests.

> **Screenshot status:** Screenshots are pending. The existing frontend build has unrelated compile and lint failures, and no local API/data service is available. Do not substitute mockups or real student data; capture reviewed screenshots with synthetic data when the app can be run safely.

## Sign in and set up MFA

1. Open the PaymentFlow address provided by your school.
2. Enter your administrator username and password, then choose **Sign in**.
3. If prompted to set up multi-factor authentication (MFA), follow the on-screen steps to connect an authenticator app, enter its six-digit code, and save the recovery codes somewhere secure.
4. Do not share a recovery code. If you lose access to your authenticator, contact your school’s system administrator.

## Find and update student records

From **Dashboard**, use the student list to search by student name or ID and narrow the list by class or payment status. Choose a student’s edit action to update the fields available on the form, then save. Confirm that the updated details appear in the list.

Only enter information that your school needs. Check the student ID before editing so that changes are applied to the correct record.

### Import students from a CSV file

The current frontend does not show a CSV student-import screen or an **Import CSV** action. Do not upload student files through another screen or send them through email as a workaround. Ask your system administrator whether a supported import workflow is available for your deployment.

The dashboard screenshot above shows the student list; it is not an import screen.

## Manage fee structures

Open **Fees** to review the school’s active fee structures.

To add a fee, use the create form:

1. Choose the class.
2. Enter the fee amount and check the currency shown by the application.
3. Review the academic year and description.
4. Choose **Create** and confirm that the new fee appears in the list.

The current screen creates fee structures and provides a delete action; it does not provide an edit action or call the action “archive.” Deleting a fee structure is handled as a soft delete by the service, but verify the affected students and school policy before confirming. If a fee needs changing, ask the system administrator for the approved procedure rather than creating a duplicate by guesswork.

## Review payments

Use the **Dashboard** student list to search for a student and review their payment status. The status distinguishes paid, partly paid, and unpaid balances. Open the payment or transaction details available from the row to review the recorded amount and confirmation details. A payment may take time to confirm on Stellar; use the status shown by PaymentFlow rather than treating a submitted payment as complete.

If a record appears delayed, use the dashboard’s sync/status controls if your account has access. Do not ask a parent to send the same payment again until the transaction has been checked.

## Raise and resolve a dispute

Open **Disputes** to review submitted cases. Use the status filter or student ID search to find a case. Open the case to read its reason and transaction reference. For a case that can be resolved, select the outcome and enter a clear resolution note before saving. Keep the note factual and follow your school’s review policy.

If the dispute is still being investigated, select **Under review** rather than closing it. The recorded decision and note become part of the school’s audit history.

## Generate a financial report

Open **Reports**, select the report period and available filters, and review the totals before downloading. Choose the format you need, such as CSV, and save the file to an approved school location. Treat exported reports as confidential student and financial records; share them only with authorised staff.

## Administrator roles

The current frontend does not include a screen for creating administrator accounts or changing roles. Do not share an account to give another staff member access. Ask your system administrator to provision or change access through the school’s approved account-management process.

## If something does not look right

- Check the student ID, class, reporting period, and school workspace before saving or exporting.
- If an error appears, note the screen and time, but do not include passwords, MFA codes, recovery codes, or full student records in a support message.
- For a payment with an unclear status, check the transaction reference before taking further payment action.
- For CSV imports and administrator-role changes, contact the system administrator; these workflows are not currently exposed in the interface.

## Review and screenshot maintenance

**Non-technical finance stakeholder review:** Pending. A school finance officer should confirm that the steps and terminology match their day-to-day workflow before this guide is treated as approved.

When screenshots are added or a change affects a workflow described here, verify the instructions against the updated interface and capture only synthetic data. Never use live student data for documentation screenshots.
