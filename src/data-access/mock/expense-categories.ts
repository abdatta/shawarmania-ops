import { normalizeCategory } from '@/domain'

import {
  DataActionError,
  type AppRole,
  type ExpenseCategoriesAdapter,
  type ExpenseCategoryMoveResult,
} from '../adapters'
import type { Tables } from '../database.types'
import { personaFixtures } from './fixtures/personas'
import type { DemoStore } from './store'

const OWNER_ID = personaFixtures.super_admin.profile.id

/** Mirror the database trigger: normalise, reuse case-insensitively, or mint. */
export function captureMockCategory(store: DemoStore, value: string, createdBy = OWNER_ID): string {
  const normalized = normalizeCategory(value)
  if (!normalized) throw new DataActionError('bad_category', 'Choose or type an expense category.')
  const existing = store.expenseCategories.find(
    (category) => category.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  )
  if (existing) return existing.name

  const row: Tables<'expense_categories'> = {
    id: `e1000000-0000-4000-b000-${String(store.expenseCategories.length + 1).padStart(12, '0')}`,
    name: normalized,
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
  store.expenseCategories.push(row)
  return row.name
}

export function createMockExpenseCategoriesAdapter(
  store: DemoStore,
  role: AppRole,
): ExpenseCategoriesAdapter {
  function ownerOnly(): void {
    if (role !== 'super_admin') {
      throw new DataActionError('not_permitted', 'Only an owner can curate expense categories.')
    }
  }

  function moveCounts(name: string): ExpenseCategoryMoveResult {
    return {
      ledgerRowsMoved: 0,
      expenseRowsMoved: store.expenses.filter(
        (row) => row.category.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ).length,
    }
  }

  return {
    async names() {
      return [...store.expenseCategories].map((row) => row.name).sort((a, b) => a.localeCompare(b))
    },

    async list() {
      return [...store.expenseCategories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({
          id: row.id,
          name: row.name,
          ledgerUsageCount: moveCounts(row.name).ledgerRowsMoved,
          expenseUsageCount: moveCounts(row.name).expenseRowsMoved,
          createdAt: row.created_at,
        }))
    },

    async rename(from, to, rewriteHistory) {
      ownerOnly()
      const source = store.expenseCategories.find(
        (row) => row.name.toLocaleLowerCase() === normalizeCategory(from).toLocaleLowerCase(),
      )
      if (!source) throw new DataActionError('not_found', 'That category is no longer there.')
      const next = normalizeCategory(to)
      if (!next) throw new DataActionError('bad_category', 'A category cannot be blank.')
      if (
        store.expenseCategories.some(
          (row) => row !== source && row.name.toLocaleLowerCase() === next.toLocaleLowerCase(),
        )
      ) {
        throw new DataActionError('already_exists', 'That category already exists. Merge into it.')
      }

      const before = source.name
      const counts = rewriteHistory
        ? moveCounts(before)
        : { ledgerRowsMoved: 0, expenseRowsMoved: 0 }
      source.name = next
      if (rewriteHistory) {
        for (const row of store.expenses) {
          if (row.category.toLocaleLowerCase() === before.toLocaleLowerCase()) row.category = next
        }
      }
      store.expenseCategoryOperations.unshift({
        id: crypto.randomUUID(),
        operation: 'rename',
        name_before: before,
        name_after: next,
        ledger_rows_moved: counts.ledgerRowsMoved,
        expense_rows_moved: counts.expenseRowsMoved,
        performed_by: OWNER_ID,
        performed_at: new Date().toISOString(),
      })
      return counts
    },

    async merge(from, into) {
      ownerOnly()
      const source = store.expenseCategories.find(
        (row) => row.name.toLocaleLowerCase() === normalizeCategory(from).toLocaleLowerCase(),
      )
      const target = store.expenseCategories.find(
        (row) => row.name.toLocaleLowerCase() === normalizeCategory(into).toLocaleLowerCase(),
      )
      if (!source || !target || source === target) {
        throw new DataActionError('bad_merge', 'Choose two different existing categories.')
      }
      const counts = moveCounts(source.name)
      for (const row of store.expenses) {
        if (row.category.toLocaleLowerCase() === source.name.toLocaleLowerCase()) {
          row.category = target.name
        }
      }
      store.expenseCategories.splice(store.expenseCategories.indexOf(source), 1)
      store.expenseCategoryOperations.unshift({
        id: crypto.randomUUID(),
        operation: 'merge',
        name_before: source.name,
        name_after: target.name,
        ledger_rows_moved: counts.ledgerRowsMoved,
        expense_rows_moved: counts.expenseRowsMoved,
        performed_by: OWNER_ID,
        performed_at: new Date().toISOString(),
      })
      return counts
    },

    async retire(name) {
      ownerOnly()
      const index = store.expenseCategories.findIndex(
        (row) => row.name.toLocaleLowerCase() === normalizeCategory(name).toLocaleLowerCase(),
      )
      if (index >= 0) store.expenseCategories.splice(index, 1)
    },

    async choices() {
      return store.expenseCategoryChoices.map((choice) => ({ ...choice }))
    },

    async saveChoice(input) {
      ownerOnly()
      const name = normalizeCategory(input.name)
      if (!name) throw new DataActionError('bad_category', 'A category needs a name.')
      const list = store.expenseCategoryChoices
      const current = input.id ? list.find((choice) => choice.id === input.id) : undefined
      if (input.id && !current) {
        throw new DataActionError('not_found', 'That category is no longer on the list.')
      }
      if (
        list.some(
          (choice) =>
            choice !== current && choice.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      ) {
        throw new DataActionError('already_exists', 'That category is already on the list.')
      }
      if (!current) {
        captureMockCategory(store, name)
        list.push({
          id: crypto.randomUUID(),
          name,
          asksNote: input.asksNote,
          managersOnly: input.managersOnly,
        })
        return
      }
      // A renamed choice is the same bucket under a better name: the rows move
      // with it and the rename is logged, as a rename with history is, or as a
      // merge where the new name is already a suggestion (as the database does).
      if (current.name !== name) {
        const find = (value: string) =>
          store.expenseCategories.find(
            (row) => row.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
          )
        const before = find(current.name)
        const after = find(name)
        if (before && after && before !== after) await this.merge(current.name, name)
        else if (before) await this.rename(current.name, name, true)
        else captureMockCategory(store, name)
        current.name = name
      }
      current.asksNote = input.asksNote
      current.managersOnly = input.managersOnly
    },

    async moveChoice(id, direction) {
      ownerOnly()
      const list = store.expenseCategoryChoices
      const from = list.findIndex((choice) => choice.id === id)
      const to = direction === 'up' ? from - 1 : from + 1
      if (from < 0 || to < 0 || to >= list.length) return
      const [choice] = list.splice(from, 1)
      if (choice) list.splice(to, 0, choice)
    },

    async removeChoice(id) {
      ownerOnly()
      const index = store.expenseCategoryChoices.findIndex((choice) => choice.id === id)
      if (index >= 0) store.expenseCategoryChoices.splice(index, 1)
    },

    async listOperations() {
      ownerOnly()
      return store.expenseCategoryOperations.map((row) => ({
        id: row.id,
        operation: row.operation as 'rename' | 'merge',
        nameBefore: row.name_before,
        nameAfter: row.name_after,
        ledgerRowsMoved: row.ledger_rows_moved,
        expenseRowsMoved: row.expense_rows_moved,
        performedBy: row.performed_by,
        performedAt: row.performed_at,
      }))
    },
  }
}
