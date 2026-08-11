/**
 * Canonical immigration pathways.
 *
 * A pathway is the **named route** a requirement belongs to: `requirements.pathway_id` is a foreign
 * key onto `immigration_pathways.pathway_id`, so no immigration requirement can be stored until its
 * pathway exists. That is why this is seeded rather than left to ingestion — the first real insert
 * fails without it.
 *
 * ## This is tier-1 data, and its gaps are deliberate
 *
 * Every field below comes from a statute or an official announcement, both verified in this
 * repository (`connectors/immigration-data/de-bundesanzeiger/README.md`). Fields that would require
 * asserting something no source has been read for are **left empty**, not filled with a plausible
 * value.
 *
 * `docs/database/entities/requirement.md` says `stages`, `permanent_residency` and `citizenship`
 * "are what make it a pathway rather than a visa type in isolation — they are what people actually
 * plan around". They are empty here, and that is a real gap rather than a formality: until they are
 * sourced, this row supports eligibility evaluation and nothing that resembles planning advice.
 * `.claude/context/countries.md` permits exactly this — *"partial coverage is acceptable and honest;
 * invented coverage is not"*.
 */

export interface OfficialSource {
  readonly url: string;
  /** What this source is authoritative *for*. A source with no scope invites over-citation. */
  readonly authoritativeFor: string;
}

export interface ImmigrationPathwaySeed {
  readonly pathwayId: string;
  readonly jurisdiction: string;
  readonly name: string;
  readonly description: string | null;
  readonly officialSources: readonly OfficialSource[];
}

export const IMMIGRATION_PATHWAYS: readonly ImmigrationPathwaySeed[] = [
  {
    pathwayId: 'de.eu-blue-card',
    jurisdiction: 'DE',
    // The statute's own term. Not translated: the row names the thing an authority would recognise.
    name: 'Blaue Karte EU (EU Blue Card, Germany)',
    description:
      'Residence permit for qualified employment under § 18g AufenthG. The salary minimum is set as ' +
      'a percentage of the annual Beitragsbemessungsgrenze in the allgemeine Rentenversicherung, and ' +
      'the concrete amount is announced annually by the Bundesministerium des Innern in the ' +
      'Bundesanzeiger under § 18g Abs. 7.',
    officialSources: [
      {
        url: 'https://www.gesetze-im-internet.de/aufenthg_2004/__18g.html',
        authoritativeFor:
          'eligibility categories, the qualifying percentages, the ISCO-08 groups that attract the ' +
          'reduced threshold, and the minimum employment duration',
      },
      {
        url: 'https://www.bundesanzeiger.de/pub/de/amtlicher-teil',
        authoritativeFor:
          'the concrete minimum gross annual salaries for each calendar year, announced by BMI ' +
          'under § 18g Abs. 7 by 31 December of the preceding year',
      },
    ],
  },
  {
    pathwayId: 'lu.eu-blue-card',
    jurisdiction: 'LU',
    // The instrument's own term, untranslated, like Germany's.
    name: 'Carte bleue européenne (EU Blue Card, Luxembourg)',
    description:
      'Autorisation de séjour aux fins d’exercer un emploi hautement qualifié under art. 45 of the ' +
      'loi du 29 août 2008 sur la libre circulation des personnes et l’immigration. **No instrument ' +
      'states the salary threshold**: art. 45, par. (1), point 3 delegates it, a règlement ' +
      'grand-ducal sets it as a multiple of the average gross annual salary, and an annual ' +
      'règlement ministériel states that average. The stored threshold is their product, computed ' +
      'at ingest and citing both instruments (ADR-0025).',
    officialSources: [
      {
        url: 'https://data.legilux.public.lu/eli/etat/leg/loi/2008/08/29/n1',
        authoritativeFor:
          'the conditions for highly-qualified employment — contract duration, professional ' +
          'qualifications, and the delegation of the salary threshold (art. 45 to 45-4)',
      },
      {
        url: 'https://data.legilux.public.lu/eli/etat/leg/rgd/2008/09/26/n3',
        authoritativeFor:
          'the multiple of the average gross annual salary that constitutes the threshold, and the ' +
          'lower multiple for occupations in CITP groups 1 and 2',
      },
      {
        url: 'https://data.legilux.public.lu/eli/etat/leg/rmin',
        authoritativeFor:
          'the average gross annual salary itself, republished annually from IGSS data as ' +
          'determined by STATEC — the operand the multiple applies to',
      },
    ],
  },
  {
    pathwayId: 'nz.aewv',
    jurisdiction: 'NZ',
    name: 'Accredited Employer Work Visa (New Zealand)',
    description:
      'Work visa for employment with an INZ-accredited employer, under the Immigration ' +
      'Instructions certified beneath the Immigration Act 2009. **The Act is empowering; the ' +
      'instructions are operative**, which is why the sourced rules come from INZ rather than ' +
      'from legislation. Its remuneration rule is stated by INZ and its figure by MBIE, so the ' +
      'stored threshold cites both instruments (ADR-0025) — with no arithmetic between them.',
    officialSources: [
      {
        url: 'https://www.immigration.govt.nz/opsmanual/',
        authoritativeFor:
          'the operative immigration instructions — employer accreditation (WA2), the Job Check ' +
          'and its remuneration and market-rate requirements (WA3), and the visa itself (WA4)',
      },
      {
        url: 'https://www.employment.govt.nz/pay-and-hours/pay-and-wages/minimum-wage/',
        authoritativeFor:
          'the adult minimum wage, per hour, which WA3.15.5 sets as the remuneration floor — ' +
          'published by MBIE, which administers the Minimum Wage Act',
      },
    ],
  },
];
