import type { ExpenseCategoryChoice } from '../../adapters'

/**
 * The list `20261104000000_expense_categories_are_the_owners_list.sql` seeds,
 * in its order (#81, design D11): the co-owner's five, with Miscellaneous
 * called Other, and Transport and Wages & bonus from what production records.
 */
export const SEEDED_EXPENSE_CATEGORY_CHOICES: readonly Omit<ExpenseCategoryChoice, 'id'>[] = [
  { name: 'Chicken', asksNote: false, managersOnly: false },
  { name: 'Raw Materials', asksNote: false, managersOnly: false },
  { name: 'Gas', asksNote: false, managersOnly: false },
  { name: 'Staff Food', asksNote: false, managersOnly: false },
  { name: 'Transport', asksNote: false, managersOnly: false },
  { name: 'Wages & bonus', asksNote: false, managersOnly: true },
  { name: 'Other', asksNote: true, managersOnly: false },
]
