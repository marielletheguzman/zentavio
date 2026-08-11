/**
 * The two boundary behaviours this controller owns.
 *
 * **Serving the catalogue**, so no surface has to carry its own copy of what a question says or
 * what shape its answer takes — the copy the eligibility panel used to carry knew about one of six
 * kinds, and every question added after it rendered as a raw key in a free-text box.
 *
 * **Turning a refused value into a 400 that names the field.** A value in the wrong shape is a bad
 * request, not a server error, and "bad request" without saying which field is a dead end for
 * whoever is debugging a client — which, on this route, may not be ours.
 */

import { BadRequestException } from '@nestjs/common';
import { InvalidFactValueError, UnknownFactKindError, type Database } from '@zentavio/db';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { EligibilityController } from './eligibility.controller.ts';
import type { EligibilityService } from './eligibility.service.ts';
import type { GapService } from '../gap/gap.service.ts';

const CATALOGUE_ROWS = [
  {
    key: 'expected_gross_annual_salary_eur',
    value_type: 'monetary',
    unit: 'EUR/year',
    prompt: 'What gross annual salary do you expect, in euros?',
    rationale: 'The EU Blue Card salary minimum is compared against gross annual pay.',
    sensitive: true,
    allowed_values: [],
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    key: 'has_recognised_academic_degree',
    value_type: 'boolean',
    unit: null,
    prompt: 'Do you hold a recognised higher-education degree?',
    rationale: '§ 18g Abs. 1 S. 1 AufenthG addresses a Fachkraft mit akademischer Ausbildung.',
    sensitive: false,
    allowed_values: [],
    created_at: new Date(),
    updated_at: new Date(),
  },
];

function stubDb(rows: unknown[] = CATALOGUE_ROWS): Kysely<Database> {
  return {
    selectFrom: () => ({
      selectAll: () => ({
        orderBy: () => ({ execute: async () => rows }),
      }),
    }),
  } as unknown as Kysely<Database>;
}

function controller(db: Kysely<Database> = stubDb()) {
  return new EligibilityController(
    {} as unknown as EligibilityService,
    {} as unknown as GapService,
    db,
  );
}

describe('the person-fact catalogue', () => {
  it('serves every kind with the type that decides its control', async () => {
    const { kinds } = await controller().factKinds();

    expect(kinds.map((kind) => kind.key)).toEqual([
      'expected_gross_annual_salary_eur',
      'has_recognised_academic_degree',
    ]);
    expect(kinds[1]?.valueType).toBe('boolean');
  });

  it('serves the prompt and the rationale, so a surface never renders a column name', async () => {
    const { kinds } = await controller().factKinds();

    expect(kinds[1]?.prompt).toBe('Do you hold a recognised higher-education degree?');
    // Asking for a salary without naming the rule that needs it reads as data collection.
    expect(kinds[0]?.rationale).toContain('Blue Card');
  });

  it('carries the unit and the permitted values, which the client cannot infer', async () => {
    const { kinds } = await controller().factKinds();

    expect(kinds[0]?.unit).toBe('EUR/year');
    expect(kinds[1]?.unit).toBeNull();
    expect(kinds[1]?.allowedValues).toEqual([]);
  });

  it('serves no database bookkeeping', async () => {
    // `created_at` and `updated_at` are how the row was maintained, not what the question is.
    const { kinds } = await controller().factKinds();

    for (const kind of kinds) {
      expect(Object.keys(kind).sort()).toEqual([
        'allowedValues',
        'key',
        'prompt',
        'rationale',
        'sensitive',
        'unit',
        'valueType',
      ]);
    }
  });
});

describe('a refused answer is a 400 that names the field', () => {
  it('translates a wrongly typed value', async () => {
    // The browser-found defect: 'no' against a boolean kind. It must not reach storage, and the
    // client must be told which field and why.
    const { recordFact } = await import('@zentavio/db');
    vi.mocked(recordFact).mockRejectedValueOnce(
      new InvalidFactValueError(
        'has_recognised_academic_degree',
        'has_recognised_academic_degree is a boolean and must be sent as true or false, not a string.',
      ),
    );

    await expect(
      controller().recordFact({ userId: 'u' } as never, {
        key: 'has_recognised_academic_degree',
        value: 'no',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('translates an unknown key', async () => {
    const { recordFact } = await import('@zentavio/db');
    vi.mocked(recordFact).mockRejectedValueOnce(new UnknownFactKindError('salary_but_misspelled'));

    await expect(
      controller().recordFact({ userId: 'u' } as never, {
        key: 'salary_but_misspelled',
        value: 1,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not swallow anything else', async () => {
    // A dropped connection is not the caller's fault, and a 400 would send them to check a value
    // that was fine.
    const { recordFact } = await import('@zentavio/db');
    vi.mocked(recordFact).mockRejectedValueOnce(new Error('connection terminated'));

    await expect(
      controller().recordFact({ userId: 'u' } as never, { key: 'k', value: 1 } as never),
    ).rejects.toThrow('connection terminated');
  });
});

vi.mock('@zentavio/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zentavio/db')>();
  return { ...actual, recordFact: vi.fn() };
});
