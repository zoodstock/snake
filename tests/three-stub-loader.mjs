/* Resolves the bare "three" specifier to the local test double, so the renderer
 * smoke test runs with no network and no node_modules. */
export function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: new URL('./three-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
