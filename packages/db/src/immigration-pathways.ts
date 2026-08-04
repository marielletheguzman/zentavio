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
];
