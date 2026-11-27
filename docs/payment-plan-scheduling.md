# Payment Plan Instalment Scheduling & Reminders — Issue #622

## Overview

Schools can offer term-based instalment plans (e.g. pay tuition in 3 monthly
instalments). The backend schedules instalment due dates at plan creation time
and runs automated due-date reminders via `instalmentReminderService`.

## Creating a plan

`POST /api/payment-plans/:studentId`

Each instalment can carry an explicit `dueDate`, or the backend can compute due
dates automatically from `startDate` + `intervalDays`.

```json
{
  "installments": [
    { "amount": 400 },
    { "amount": 400 },
    { "amount": 200 }
  ],
  "startDate": "2024-09-01",
  "intervalDays": 30
}
```

This creates three instalment records with due dates on 2024-09-01, 2024-10-01,
and 2024-11-01.

## Partial payments

`PATCH /api/payment-plans/:studentId/installment/:index`

```json
{ "paidAmount": 150 }
```

A partial payment accumulates against `paidAmount` without closing the
instalment. The outstanding balance is `amount - paidAmount`. Once `paidAmount`
reaches `amount` the instalment is automatically marked `paid: true`.

## Reminder schedule

The `instalmentReminderService` runs daily (configurable via `REMINDER_CRON`)
and sends notifications for:

| Trigger            | Type                       |
|--------------------|----------------------------|
| 3 days before due  | `instalment_reminder`      |
| 1 day before due   | `instalment_reminder`      |
| Overdue (≤ GRACE_PERIOD_DAYS) | `instalment_grace_period` |

### Environment variables

| Variable                        | Default      | Description                                       |
|---------------------------------|--------------|---------------------------------------------------|
| `REMINDER_CRON`                 | `0 8 * * *`  | Cron schedule for the reminder job                |
| `INSTALMENT_REMINDER_WINDOW_DAYS` | `3,1`      | Days before due date to send reminders            |
| `GRACE_PERIOD_DAYS`             | `3`          | Days after due date before grace-period notice    |

## Grace period flow

An instalment that passes its `dueDate` without full payment enters the grace
period. During this window (default 3 days) a grace-period notification is
dispatched. After the grace period, the plan's `isCurrent` virtual returns
`false` and the instalment is considered overdue.
