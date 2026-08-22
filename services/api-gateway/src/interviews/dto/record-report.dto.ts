/**
 * One interview report.
 *
 * **The stage vocabulary is closed and validated here as well as in the database.** A free-text
 * stage would make aggregation impossible — "sys design" and "system design round" are one stage
 * described twice, and a support floor counted across them counts nothing.
 */

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const STAGE_KINDS = [
  'recruiter-screen',
  'technical-screen',
  'coding',
  'system-design',
  'take-home',
  'behavioural',
  'hiring-manager',
  'panel',
  'final',
] as const;

export class StageDto {
  @IsInt()
  @Min(1)
  position!: number;

  @IsIn([...STAGE_KINDS])
  kind!: (typeof STAGE_KINDS)[number];
}

export class RecordReportDto {
  @IsUUID()
  companyId!: string;

  /** Matches `careers.family`. The unit of support — never a company on its own (ADR-0031). */
  @IsString()
  @MaxLength(60)
  roleFamily!: string;

  /** When they interviewed, not when they told us. The repository refuses a future date. */
  @IsISO8601()
  interviewedOn!: string;

  /** A report with no stages counts toward support while describing nothing. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StageDto)
  stages!: StageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CorrectReportDto {
  @IsOptional()
  @IsISO8601()
  interviewedOn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StageDto)
  stages?: StageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
