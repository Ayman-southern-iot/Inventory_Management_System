import ts from 'typescript';

/**
 * Structural stand-in for `vite`'s `Plugin`. Vite is a transitive dependency of vitest and is
 * not resolvable from this package's own tsconfig, and taking a direct dependency on it just to
 * name one type would be worse than describing the two fields actually used.
 */
interface Plugin {
  name: string;
  enforce?: 'pre' | 'post';
  transform(code: string, id: string): { code: string; map: unknown } | null;
}

/**
 * Nest's constructor injection reads `design:paramtypes`, which only exists when TypeScript
 * emits decorator metadata. Vitest transforms TypeScript with esbuild, and esbuild does not
 * implement `emitDecoratorMetadata` at all — under the default pipeline every provider with an
 * untokenised constructor dependency fails to resolve and the whole app refuses to boot.
 *
 * So the integration config turns Vite's esbuild transform off (`esbuild: false`) and hands
 * `.ts` files to the TypeScript compiler instead, with the same decorator options the real
 * build uses. `tsc` is already a dependency, so this costs no new packages and cannot drift
 * from `tsconfig.json` the way a second toolchain's approximation would.
 *
 * Cost: transpiling with tsc is slower than esbuild. At this suite's size that is a couple of
 * seconds, and a suite that silently fails to boot Nest is worth nothing at any speed.
 */
const TS_FILE = /\.[cm]?ts$/;

export function decoratorMetadata(): Plugin {
  return {
    name: 'ims:decorator-metadata',
    enforce: 'pre',

    transform(code: string, id: string) {
      const fileName = id.split('?')[0] ?? id;
      if (!TS_FILE.test(fileName) || fileName.endsWith('.d.ts')) return null;
      if (fileName.includes('/node_modules/')) return null;

      const output = ts.transpileModule(code, {
        fileName,
        reportDiagnostics: false,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          // ESM out, because vite-node consumes ES modules. Import elision still respects the
          // explicit `type` modifier, which is what keeps `design:paramtypes` honest: a
          // `import type { AppConfig }` becomes `Object` and is expected to carry `@Inject`.
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          sourceMap: true,
          inlineSources: false,
        },
      });

      return {
        code: output.outputText,
        map: output.sourceMapText ? (JSON.parse(output.sourceMapText) as unknown) : null,
      };
    },
  };
}
