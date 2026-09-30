import { expect, test } from '@playwright/test';
import { createMachine, createTicket, navTo, openOwner, OWNER_STATE, SHOPS, shopBySlug, uniq } from './helpers';

test.use({ storageState: OWNER_STATE });

test('create a staff ticket from the Tickets page', async ({ page }) => {
  const shop = await shopBySlug(page.request, SHOPS.kepong.slug);
  const machine = await createMachine(page.request, shop.id);
  const title = `E2E leaking hose ${uniq()}`;

  await openOwner(page);
  await navTo(page, 'Tickets');
  await page.getByRole('button', { name: 'New ticket' }).click();

  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByRole('combobox', { name: 'Shop' }).selectOption({ label: shop.name });
  await dialog.getByLabel('Machine (optional)').selectOption({ label: `${machine.code} · washer 10 kg` });
  await dialog.getByLabel('Category').selectOption({ label: 'Water leak' });
  await dialog.getByLabel('Title (optional)').fill(title);
  await dialog.getByLabel('Details (optional)').fill('Found a puddle under the machine during the morning round.');
  await dialog.getByLabel('Priority').selectOption({ label: 'High' });
  await dialog.getByRole('button', { name: 'Create ticket' }).click();

  // Lands on the new ticket.
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/owner\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
  await expect(page.getByText(`${shop.name} · ${machine.code}`, { exact: false })).toBeVisible();
  await expect(page.getByText('High priority')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText('Found a puddle under the machine');

  // …and is listed with the open tickets.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
});

test('add an internal note and change the status of a ticket', async ({ page }) => {
  const shop = await shopBySlug(page.request, SHOPS.ss2.slug);
  const title = `E2E note & status ${uniq()}`;
  const ticket = await createTicket(page.request, shop.id, title);
  const note = `Called the technician, visit booked ${uniq()}`;

  await openOwner(page, `/owner/tickets/${ticket.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
  const update = page.getByRole('region', { name: 'Update' });
  const timeline = page.getByRole('region', { name: 'Timeline' });

  await update.getByLabel('Internal note').fill(note);
  await update.getByRole('button', { name: 'Add note' }).click();
  await expect(timeline.getByText(note)).toBeVisible();
  await expect(update.getByLabel('Internal note')).toHaveValue('');

  await expect(update.getByRole('button', { name: 'Open', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await update.getByRole('button', { name: 'In progress', exact: true }).click();
  await expect(update.getByRole('button', { name: 'In progress', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline.getByText('Status: Open → In progress')).toBeVisible();

  // Survives a reload (it was saved, not just optimistic UI).
  await page.reload();
  await expect(page.getByRole('region', { name: 'Timeline' }).getByText(note)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Update' }).getByRole('button', { name: 'In progress', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('region', { name: 'Update' }).getByRole('button', { name: 'Resolved', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Timeline' }).getByText('Status: In progress → Resolved')).toBeVisible();
});

test('create a DuitNow refund from a ticket, approve it and mark it paid', async ({ page }) => {
  const shop = await shopBySlug(page.request, SHOPS.damansara.slug);
  const title = `E2E coins swallowed ${uniq()}`;
  const ticket = await createTicket(page.request, shop.id, title, { category: 'coin_jammed' });
  const reference = `DN${Date.now()}`;

  await openOwner(page, `/owner/tickets/${ticket.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
  const refunds = page.getByRole('region', { name: 'Refunds' });
  await refunds.getByRole('button', { name: 'Create refund' }).click();
  await refunds.getByLabel('Amount (RM)').fill('7.50');
  await refunds.getByLabel('Pay back by').selectOption({ label: 'DuitNow transfer' });
  const create = refunds.getByRole('button', { name: 'Create refund request' });
  await expect(create).toBeDisabled(); // DuitNow needs a phone number
  await refunds.getByLabel('DuitNow phone number').fill('012-345 6789');
  await refunds.getByLabel('Note (optional)').fill('Customer showed a photo of the coin slot');
  await create.click();

  await expect(refunds.getByText('RM 7.50 · DuitNow transfer')).toBeVisible();
  await expect(refunds.getByText('Awaiting decision')).toBeVisible();

  // Decide it in the refund queue.
  await refunds.getByRole('link', { name: 'Decide in the refund queue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Refunds' })).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: `#${ticket.ref}` });
  await expect(card).toContainText('RM 7.50');
  await expect(card).toContainText('012-345 6789');
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card.getByText('Approved', { exact: true })).toBeVisible();

  const markPaid = card.getByRole('button', { name: 'Mark paid' });
  await expect(markPaid).toBeDisabled();
  await card.getByLabel('DuitNow transfer reference').fill(reference);
  await markPaid.click();

  // Leaves the queue and shows up in history with the reference.
  await expect(card).toHaveCount(0);
  const history = page.getByRole('region', { name: 'History' });
  const row = history.getByRole('listitem').filter({ hasText: `ref ${reference}` });
  await expect(row).toContainText('Paid');
  await expect(row).toContainText('RM 7.50');

  // The ticket shows the paid refund too.
  await openOwner(page, `/owner/tickets/${ticket.id}`);
  await expect(page.getByRole('region', { name: 'Refunds' })).toContainText(`ref ${reference}`);
  await expect(page.getByRole('region', { name: 'Refunds' }).getByText('Paid', { exact: true })).toBeVisible();
});
