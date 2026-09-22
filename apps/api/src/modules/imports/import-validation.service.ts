import { Inject, Injectable } from '@nestjs/common';
import { ImportIssueCode, type ImportDiff, type ImportIssue } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { buildImportDiff } from './import-diff';
import { buildImportLookups, type ImportLookups } from './import-lookups';
import { parseImportCsv } from './import-parser';
import { validateImport, type ImportPlan } from './import-validator';

/**
 * Stages 1–3 of the pipeline against the real catalogue: read the file, load what the rules need,
 * decide what it would do (`importing_data.md` §5.2–5.3).
 *
 * Read-only from end to end. Nothing here writes, and nothing here decides to apply — the plan it
 * returns is what the preview is built from (part E) and what apply executes (part G), and the
 * human gate sits between the two.
 *
 * The four bulk loads (§11.1) are the whole performance story. Five lookups per row across five
 * thousand rows is twenty-five thousand round trips before a single write; four queries and a
 * handful of maps is the same answer in one.
 */
export interface ValidationOutcome {
  /** Null whenever `errors` is non-empty. */
  plan: ImportPlan | null;
  /** What the confirm screen shows. Null for the same reason `plan` is. */
  diff: ImportDiff | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Data rows read, for the job's progress figures. */
  rowCount: number;
}

export interface ValidateOptions {
  /**
   * A restore is exempt from the origin check and from the row cap (§10, C40).
   *
   * Both exist to protect the catalogue from a foreign or oversized *forward* import. Applied to
   * a snapshot they would do the opposite: a backup taken from a catalogue larger than the cap,
   * or restored after the database moved to a new machine, would be a backup that cannot be
   * restored — discovered at the worst possible moment.
   */
  isRestore?: boolean;
}

@Injectable()
export class ImportValidationService {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly stock: StockService,
    private readonly settings: SettingsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async validate(text: string, options: ValidateOptions = {}): Promise<ValidationOutcome> {
    const isRestore = options.isRestore === true;

    const parsed = parseImportCsv(text, {
      maxRows: isRestore ? Number.POSITIVE_INFINITY : this.config.imports.maxRows,
      expectedDeploymentId: isRestore ? null : await this.settings.deploymentId(),
    });

    if (parsed.issues.length > 0) {
      return {
        plan: null,
        diff: null,
        errors: parsed.issues,
        warnings: [],
        rowCount: parsed.rows.length,
      };
    }

    const lookups = await this.loadLookups();
    const result = validateImport(parsed.rows, lookups);

    // Only worth asking when there is something to approve. A file that is going to be refused
    // does not need advice about what its names look like.
    if (result.plan) {
      result.warnings.push(...(await this.findNearDuplicates(result.plan)));
    }

    return {
      ...result,
      // Built last, so the warnings it carries are all of them — including the near-duplicate
      // pass, which runs after the validator has finished.
      diff: result.plan ? buildImportDiff(result.plan, lookups, result.warnings) : null,
      rowCount: parsed.rows.length,
    };
  }

  /**
   * "This looks like something you already have" — §5.3 stage 7, and the one superlinear step in
   * the whole pipeline (§11.1).
   *
   * Warning-only by construction. §2.4: the brief asked that no wrong name be accepted, and a
   * fuzzy match cannot tell a typo from two genuinely similar products — `Cable HDMI 2m` and
   * `Cable HDMI 3m` are neither a mistake nor the same thing. Blocking on a guess would make the
   * importer unusable for any catalogue with a naming convention, so it advises and the human
   * decides.
   *
   * Above `IMPORT_FUZZY_MATCH_MAX_NEW_NAMES` it does not run, and **says so in the report**.
   * Dropping a check silently on precisely the largest imports is the opposite of what it is for.
   */
  private async findNearDuplicates(plan: ImportPlan): Promise<ImportIssue[]> {
    const newProducts = plan.products.filter((product) => product.productId === null);
    const newCategories = plan.categoriesToCreate;
    const total = newProducts.length + newCategories.length;

    if (total === 0) return [];

    if (total > this.config.imports.fuzzyMatchMaxNewNames) {
      return [
        {
          code: ImportIssueCode.NEAR_DUPLICATE_CHECK_SKIPPED,
          row: 2,
          column: null,
          value: null,
          message: `This file introduces ${total} new names, above the ${this.config.imports.fuzzyMatchMaxNewNames} this check will compare. It has been skipped, so nothing here says whether any of them duplicate something you already have.`,
        },
      ];
    }

    const threshold = this.config.imports.fuzzyMatchThreshold;
    const [productMatches, categoryMatches] = await Promise.all([
      this.products.findSimilarNames(
        newProducts.map((product) => product.name),
        threshold,
      ),
      this.categories.findSimilarNames(
        // The leaf is the only new name; the ancestors of a new path are created too, and each
        // arrives here as its own planned category.
        newCategories.map((category) => category.path[category.path.length - 1]!),
        threshold,
      ),
    ]);

    const issues: ImportIssue[] = [];

    for (const product of newProducts) {
      const matches = productMatches.filter((match) => match.candidate === product.name);
      if (matches.length === 0) continue;
      issues.push({
        code: ImportIssueCode.NAME_NEAR_DUPLICATE,
        row: product.lines[0] ?? 2,
        column: 'product_name',
        value: product.name,
        message: `"${product.name}" is new, and the catalogue already has ${describeMatches(matches)}. Check this is not the same thing under a different spelling — importing it creates a second product.`,
      });
    }

    for (const category of newCategories) {
      const leaf = category.path[category.path.length - 1]!;
      const matches = categoryMatches.filter((match) => match.candidate === leaf);
      if (matches.length === 0) continue;
      issues.push({
        code: ImportIssueCode.CATEGORY_NEAR_DUPLICATE,
        row: 2,
        column: 'category_path',
        value: category.path.join(' / '),
        message: `The category "${leaf}" is new, and there is already ${describeMatches(matches)}. Check this is not the same category under a different spelling.`,
      });
    }

    return issues;
  }

  /**
   * The four queries of §11.1, run together because none depends on another.
   *
   * Inactive rows are included at every level on purpose: validation has to be able to say "that
   * category is retired" rather than "that category does not exist", and the two call for
   * completely different fixes by the person holding the spreadsheet.
   */
  async loadLookups(): Promise<ImportLookups> {
    const [categories, rooms, placements] = await Promise.all([
      this.categories.tree(),
      this.locations.listRooms(true),
      this.stock.allPlacements(),
    ]);

    /*
     * Uncapped, deliberately. `IMPORT_MAX_ROWS` governs the size of the *file*, not the size of
     * the catalogue it is applied to — and the deactivation sweep reads every product, so a
     * truncated list would retire the products it had simply never been shown. The paging loop
     * is complete by construction; the ceiling is the only part being waived.
     */
    const products = await this.products.listAll({
      includeInactive: true,
      max: Number.POSITIVE_INFINITY,
    });

    return buildImportLookups({
      products,
      categories,
      rooms,
      placements: placements.map((placement) => ({
        productId: placement.product_id,
        compartmentId: placement.compartment_id,
        quantity: placement.quantity,
        reservedQty: placement.reserved_qty,
        quarantinedQty: placement.quarantined_qty,
      })),
    });
  }
}

/** At most two, because a list of nine near-matches is not advice, it is noise. */
function describeMatches(matches: { name: string }[]): string {
  const names = matches.slice(0, 2).map((match) => `"${match.name}"`);
  const rest = matches.length - names.length;
  const shown = names.join(' and ');
  return rest > 0 ? `${shown} and ${rest} other similar name${rest === 1 ? '' : 's'}` : shown;
}
