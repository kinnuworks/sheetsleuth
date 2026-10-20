import { describe, expect, it } from 'vitest';

import { DependencyGraph, buildDependencyGraph } from './index.js';

describe('dependency graph', () => {
  it('expands ranges lazily and finds precedents in both directions', () => {
    const graph = buildDependencyGraph([
      { id: 'Model!A1', sheet: 'Model', address: 'A1', row: 1, column: 1 },
      { id: 'Model!A2', sheet: 'Model', address: 'A2', row: 2, column: 1 },
      { id: 'Model!B1', sheet: 'Model', address: 'B1', row: 1, column: 2, formula: '=SUM(A1:A2)' },
    ]);

    expect(graph.dependenciesOf('Model!B1')).toEqual(['Model!A1', 'Model!A2']);
    expect(graph.dependentsOf('Model!A1')).toEqual(['Model!B1']);
  });

  it('finds SCCs and returns dependency-first topological order', () => {
    const graph = new DependencyGraph([
      { id: 'A', sheet: 'S', address: 'A1', row: 1, column: 1 },
      { id: 'B', sheet: 'S', address: 'B1', row: 1, column: 2 },
      { id: 'C', sheet: 'S', address: 'C1', row: 1, column: 3 },
    ]);
    graph.addDependency('B', 'A');
    graph.addDependency('C', 'B');
    graph.addDependency('B', 'C');

    expect(graph.stronglyConnectedComponents()).toContainEqual(['C', 'B']);
    expect(graph.topologicalOrder()).toEqual(['A', 'C', 'B']);
  });
});
