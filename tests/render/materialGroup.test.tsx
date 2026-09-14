import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MaterialGroup } from '../../src/components/views/MaterialGroup';
import type { User, Vendor } from '../../src/types';

/**
 * A closed group draws nothing.
 *
 * The collapse is a CSS one — the panel animates from `grid-rows-[0fr]` to
 * `1fr` — so the rows inside it used to be rendered whether or not anybody
 * could see them. Measured on a register of ten thousand sources, one category
 * page carried about 49,000 DOM nodes, nearly all of them invisible; mounting
 * the body on first open brought the same page to 521.
 *
 * This is the assertion that keeps it that way, because nothing about the
 * screen looks different when it regresses — only the node count does.
 */

const admin = { username: 'admin', role: 'admin', name: 'مدیر' } as User;

const vendor = (i: number): Vendor => ({
  id: `V-${i}`,
  name: `شرکت ${i}`,
  nameEn: `Supplier ${i}`,
  country: 'India',
  material: 'پاراستامول',
  materialEn: 'Paracetamol',
  cas: '103-90-2',
  category: 'foreign',
  status: 'approved',
  grade: 'B',
  scores: { commercial: 70, qa: 70, planning: 70, finance: 70 },
  analysisRecords: [],
  activityLogs: [],
} as unknown as Vendor);

const group = {
  fa: 'پاراستامول',
  en: 'Paracetamol',
  cas: '103-90-2',
  vendors: [vendor(1), vendor(2), vendor(3)],
} as never;

const mount = (expandedMaterial: string | null = null) =>
  render(
    <MaterialGroup
      group={group}
      onSelectVendor={() => {}}
      currentUser={admin}
      categoryId="foreign"
      expandedMaterial={expandedMaterial}
      onToggleMaterial={() => {}}
    />,
  );

const sourceRows = () => screen.queryAllByLabelText(/^مشاهده جزئیات/);

describe('a material group', () => {
  test('renders none of its sources while it is closed', () => {
    mount();
    expect(sourceRows()).toHaveLength(0);
    // The header is still there — a closed group is a row you can read and open.
    expect(screen.getByText('پاراستامول')).toBeTruthy();
  });

  test('mounts its sources when it is opened', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(sourceRows()).toHaveLength(3);
  });

  test('keeps them mounted once opened, so re-opening is instant', () => {
    mount();
    const header = screen.getByRole('button', { expanded: false });
    fireEvent.click(header);
    expect(sourceRows()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { expanded: true }));
    // Closed again — the panel animates shut and the rows stay in the tree,
    // which is what makes the close animation possible at all.
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(sourceRows()).toHaveLength(3);
  });

  test('a group that is the active material opens itself', () => {
    // Returning from a source's page re-opens the material it belongs to.
    mount('Paracetamol');
    expect(sourceRows()).toHaveLength(3);
  });
});
